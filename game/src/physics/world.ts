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
//
// Iteration 08 (Lane B): stacked levels. A column's boxes come from its multi-level profile
// (StaticQuery.columnSolids): the rock under the lowest floor and every slab between a lower
// band's ceiling and an upper band's floor (so bodies rest on the upper deck, hit the slab
// underside from below and fall through apertures), stair treads of every distinct flight (from
// the ceiling of whatever lies under it), railings as thin boxes, props of every level.

// Task office-seamless-20261029 (lane LIFT): the moving elevator cab (a Levels dynamic volume, gen/levels.ts). Its interior
// columns get NO static boxes; a KINEMATIC body (floor slab under the cab floor + ceiling slab over it) follows the cab
// every frame; the doorway columns (gate) are solid except an opening at each stop, filled by a static box while that
// landing's doors are shut. RIDERS: before stepping, every simulating body inside the cab (ragdoll parts, loose items,
// chunks, flares, filler stock), resting casings / flesh chunks and frozen corpses are carried by the cab's dy, so the
// cab frame is exact (no penetration, no falling behind the floor).

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {CELL} from '../gen/grid';
import {RAIL_H, RAIL_HALF, type DynamicVolume, type VolumeGate} from '../gen/levels';
import {StaticQuery, rampPieces, type StaticLayout} from './staticQuery';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_RAGDOLL, GROUP_STATIC, Ragdoll, RagdollJoint, type KillImpulse, type RagdollTarget} from './ragdoll';
import {CasingSystem, type CasingAudio, type CasingKind} from './casings';
import {PhysChunks, STATIC_CHUNK_M, type BodyHost, type PhysAudio} from './chunks';
import {DynamicItems} from './dynamicItems';
import {LiveSAPBroadphase, useSparseCollisionMatrix} from './broadphase';
import {PHYS_MATS, type PhysMat} from '../damage/materials';
import type {PropPlacement} from '../gen/props';

export type {KillImpulse, RagdollTarget} from './ragdoll';
export type {CasingKind} from './casings';

export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 3;
export const MAX_SIMULATING_RAGDOLLS = 4;
const CHUNK = STATIC_CHUNK_M / CELL; // cells (4 m; task office-props-physics-scale-20261030: shared with chunks.ts staticChunkKey)
const ACTIVE_RADIUS = 3; // m around each simulating pelvis
/** Iteration 07: m around each simulating item / prop / chunk body. */
const BODY_RADIUS = 1.6;

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
  // Pistol lane: slide port right of the slide (dev placeholder geometry). Reuses the rifle brass casing kind (same
  // pooled mesh; a 9 mm case is smaller, but a separate mesh is not worth a pool).
  // 2026-10-28 user weapon models: a held model's `Eject` marker (EjectionPortSource.ejectionMarker) overrides `pos`;
  // these constants remain the fallback for a model without one. `dir` / `kind` always come from here.
  pistol: {pos: new THREE.Vector3(0.016, 0.058, -0.045), dir: new THREE.Vector3(1, 0.7, 0.15).normalize(), kind: 'rifle'},
};

/** Killing-shot impulse (N·s). Rifle ~38; shotgun 22 + 85 x pellet fraction (full hit ~107). */
export function killImpulseStrength(weaponId: string, pelletsHit: number, pellets: number): number {
  if (pellets > 1 || weaponId === 'shotgun') return 22 + 85 * Math.min(1, pelletsHit / Math.max(1, pellets));
  return 38;
}

/** Provided by Viewmodel.ejectionPort (structural, keeps this module testable without assets). */
export interface EjectionPortSource {
  ejectionPort(main: THREE.PerspectiveCamera, itemId: string, pos: THREE.Vector3, dir: THREE.Vector3, outPos: THREE.Vector3, outDir: THREE.Vector3): boolean;
  /** The gun model's `Eject` marker in the same grip-relative frame as EJECTION_PORTS[..].pos, or null without one. */
  ejectionMarker?(itemId: string): THREE.Vector3 | null;
}

export interface PhysicsAudio extends CasingAudio, PhysAudio {
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
  /** Iteration 07 (Lane K): simulating item / prop bodies and physical chunks. */
  dynamic: ReturnType<DynamicItems['stats']>;
  chunks: ReturnType<PhysChunks['stats']>;
}

interface Chunk { bodies: CANNON.Body[]; active: boolean }

/** Lane LIFT: the cannon side of one dynamic volume (the elevator cab). */
interface CabBodies {
  body: CANNON.Body;
  /** Floor / ceiling the bodies were last placed at (riders: dy). */
  last: number;
  lastCeil: number;
  fillers: {body: CANNON.Body; gate: VolumeGate; stop: number; inWorld: boolean}[];
}
/** Slab thickness of the cab's kinematic floor / ceiling (m; thick: no tunnelling even at a flare's 9 m/s). */
export const CAB_SLAB = 0.5;

/** The passage rect (x / z) of a volume gate: beyond its side by `depth`, over its opening range. */
export function gateRect(v: DynamicVolume, g: VolumeGate): {x0: number; z0: number; x1: number; z1: number} {
  const a0 = Math.min(g.a0, g.a1), a1 = Math.max(g.a0, g.a1), d = Math.max(0, g.depth);
  if (g.side === 'N') return {x0: a0, x1: a1, z0: v.z0 - d, z1: v.z0};
  if (g.side === 'S') return {x0: a0, x1: a1, z0: v.z1, z1: v.z1 + d};
  if (g.side === 'W') return {x0: v.x0 - d, x1: v.x0, z0: a0, z1: a1};
  return {x0: v.x1, x1: v.x1 + d, z0: a0, z1: a1};
}

/**
 * Riders region: a point inside a volume's interior box between the given floor and ceiling, padded by RIDE_PAD so a thing
 * straddling the cab door plane (a flare lying across the threshold) rides too — the band beyond the interior is shaft wall
 * or doorway, never a landing (that starts a whole shaft wall further out).
 */
export const RIDE_PAD = 0.15;
function inCab(v: DynamicVolume, floor: number, ceil: number, x: number, y: number, z: number, pad = RIDE_PAD): boolean {
  return x > v.x0 - pad && x < v.x1 + pad && z > v.z0 - pad && z < v.z1 + pad && y > floor - 0.12 && y < ceil + 0.12;
}

/**
 * Iteration 08 (Lane B): an external owner of rigid bodies in this bounded world (e.g. Lane S's
 * filler shelf stock). Register with PhysicsSystem.addSource: the world is stepped while any source
 * has awake bodies, static collision chunks (all levels: floors, slab undersides, treads, railings,
 * props) are kept around its active points, update() runs every frame after the step (also while
 * idle), clear() on New Station. Use GROUP_* filters from ragdoll.ts, `material()` for contacts.
 */
export interface BodySource {
  /** Simulating (dynamic, awake) bodies right now. */
  readonly awake: number;
  /** Positions of simulating bodies. */
  activePoints(out: CANNON.Vec3[]): void;
  update?(dt: number): void;
  clear?(): void;
  /** Lane LIFT: carry resting things inside the moving elevator cab by dy (`inside(x, y, z)`; simulating bodies are carried by the physics system). */
  carry?(inside: (x: number, y: number, z: number) => boolean, dy: number): void;
  /** Lane LIFT: move resting things out of a doorway the landing doors just shut on (`move` -> new x / z, or null). */
  relocate?(move: DoorwayMove): void;
}

/** Where a point in a shutting doorway goes (new x / z: just inside the cab or just onto the landing), or null when it is not in it. */
export type DoorwayMove = (x: number, y: number, z: number) => [number, number] | null;

/**
 * Lane LIFT: the doorway sweep of a volume gate at one stop — a point inside the passage (the shaft wall's doorway, from the
 * floor to the opening's head) is moved to the nearer side: 10 cm into the cab, or 10 cm out onto the landing.
 */
export function doorwayMover(v: DynamicVolume, g: VolumeGate, stop: number): DoorwayMove {
  const r = gateRect(v, g), d = Math.max(0, g.depth);
  return (x, y, z) => {
    if (x <= r.x0 || x >= r.x1 || z <= r.z0 || z >= r.z1 || y < stop - 0.3 || y > stop + g.height) return null;
    // s: depth from the cab plane outward (0 .. d)
    const s = g.side === 'N' ? v.z0 - z : g.side === 'S' ? z - v.z1 : g.side === 'W' ? v.x0 - x : x - v.x1;
    const to = s < d / 2 ? -0.1 : d + 0.1;
    const ds = to - s;
    if (g.side === 'N') return [x, z - ds];
    if (g.side === 'S') return [x, z + ds];
    if (g.side === 'W') return [x - ds, z];
    return [x + ds, z];
  };
}

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

export class PhysicsSystem implements BodyHost {
  world: CANNON.World | null = null;
  readonly casings = new CasingSystem();
  /**
   * Iteration 07 (Lane K): activate-on-hit loose items / loot lots / light props (lane contract name
   * `physics.dynamicItems`) and physical chunks (world pieces + torn flesh / cloth), all in this one
   * bounded cannon world.
   */
  readonly dynamicItems: DynamicItems;
  readonly chunks: PhysChunks;
  /**
   * Loot-holder collision for items / chunks (shelf tiers etc., physics/holderShapes.ts); set per station
   * by the game (ContainerManager.physicsBoxes). null / a null result: the prop's full AABB.
   */
  holderBoxes: ((p: PropPlacement) => THREE.Box3[] | null) | null = null;
  private readonly physMats = new Map<PhysMat, CANNON.Material>();
  /** Iteration 08 (Lane B): registered external body owners (see BodySource). */
  private readonly sources: BodySource[] = [];
  private query: StaticQuery | null = null;
  private readonly ragdollMat = new CANNON.Material('ragdoll');
  private readonly staticMat = new CANNON.Material('static');
  private ragdolls: Ragdoll[] = [];
  private frozen: Ragdoll[] = [];
  private failedCount = 0;
  private readonly staticChunks = new Map<number, Chunk>();
  /** Lane LIFT: cannon bodies of the Levels dynamic volumes (elevator cabs), and the volume set they were built for. */
  private readonly cabs = new Map<DynamicVolume, CabBodies>();
  private volVersion = -1;
  /** Lane LIFT safety net (QA / tests): simulating bodies put back on the cab floor after sinking below it. */
  cabClamps = 0;
  private chunkTimer = 0;
  private time = 0;
  private stepMs = 0;
  private stepMsMax = 0;
  private pending: {t: number; weaponId: string; port: EjectionPortSource; camera: THREE.PerspectiveCamera; inherit: {vx: number; vy?: number; vz: number}}[] = [];
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly eyeTmp = new THREE.Vector3();

  constructor(scene: THREE.Object3D | null, public audio: PhysicsAudio | null = null) {
    this.dynamicItems = new DynamicItems(this);
    this.chunks = new PhysChunks(this);
    if (scene) scene.add(this.casings.group, this.chunks.group);
    this.casings.audio = audio;
  }

  /** BodyHost: the read-only station statics (null between stations). */
  get statics(): StaticQuery | null {
    return this.query;
  }

  /** BodyHost (task office-interactions-layout-20261030, lane PHYS): contact material of the station statics. */
  get staticMaterial(): CANNON.Material {
    return this.staticMat;
  }

  /** BodyHost: cannon material of a rigid-body family (contacts vs the station defined in build()). */
  material(m: PhysMat): CANNON.Material {
    let mat = this.physMats.get(m);
    if (!mat) { mat = new CANNON.Material(`phys-${m}`); this.physMats.set(m, mat); }
    return mat;
  }

  /** BodyHost: new bodies joined the world — make sure static collision exists around them now. */
  bodiesChanged(): void {
    this.refreshChunks();
  }

  /** BodyHost (task office-props-physics-scale-20261030, lane PHYS): the static chunk `key` is in the world now. */
  chunkActive(key: number): boolean {
    return !!this.staticChunks.get(key)?.active;
  }

  /** Iteration 08 (Lane B): register an external body owner (stepped / statics kept around it / cleared with the station). */
  addSource(s: BodySource): void {
    if (!this.sources.includes(s)) this.sources.push(s);
  }

  private get sourcesAwake(): boolean {
    for (const s of this.sources) if (s.awake > 0) return true;
    return false;
  }

  /** Build the world for a new station (disposes the previous one first). */
  build(layout: StaticLayout): void {
    this.dispose();
    this.query = new StaticQuery(layout);
    const w = new CANNON.World({gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true});
    // task office-props-physics-scale-20261030 (lane PHYS): SAP's exact pairs without its quadratic walk over static bodies, and
    // an id-keyed first-contact matrix (physics/broadphase.ts) — the tower's chunks keep ~1300 static boxes around a moving body
    w.broadphase = new LiveSAPBroadphase(w);
    useSparseCollisionMatrix(w);
    // AABB pair tests: the default bounding-SPHERE test pairs every limb with every nearby 4 m
    // slab/wall box (~70 pairs per 4 ragdolls, ~2.7 ms/step of sphere-box narrowphase).
    w.broadphase.useBoundingBoxes = true;
    (w.solver as CANNON.GSSolver).iterations = 14; // with Ragdoll.preStep's fall clamp; ~0.2 ms/ragdoll/frame
    w.defaultContactMaterial.friction = 0.5;
    w.defaultContactMaterial.restitution = 0;
    w.addContactMaterial(new CANNON.ContactMaterial(this.ragdollMat, this.staticMat, {friction: 0.62, restitution: 0.02, contactEquationStiffness: 1e7, contactEquationRelaxation: 3}));
    // Iteration 07: items / props / chunks vs the station (and resting loose props use these materials too)
    for (const k of Object.keys(PHYS_MATS) as PhysMat[]) {
      const c = PHYS_MATS[k];
      w.addContactMaterial(new CANNON.ContactMaterial(this.material(k), this.staticMat, {friction: c.friction, restitution: c.restitution, contactEquationStiffness: 1e7, contactEquationRelaxation: 3}));
    }
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
    this.dynamicItems.clear();
    this.chunks.clear();
    for (const s of this.sources) s.clear?.();
    if (w) {
      for (const r of this.ragdolls) r.freeze();
      for (const c of w.constraints.slice()) w.removeConstraint(c);
      for (const b of w.bodies.slice()) w.removeBody(b);
    }
    this.ragdolls = [];
    this.frozen = [];
    this.failedCount = 0;
    this.staticChunks.clear();
    this.cabs.clear();
    this.volVersion = -1;
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
    if (!port.ejectionPort(camera, weaponId, port.ejectionMarker?.(weaponId) ?? spec.pos, spec.dir, this.tmpPos, this.tmpDir)) return;
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
    this.syncVolumes(); // lane LIFT: the moving cab (kinematic slabs, doorway fillers) + its riders, before anything steps
    if (this.pending.length) {
      for (const p of this.pending) p.t -= dt;
      const due = this.pending.filter(p => p.t <= 0);
      this.pending = this.pending.filter(p => p.t > 0);
      for (const p of due) this.ejectNow(p.weaponId, p.port, p.camera, p.inherit);
    }
    this.casings.update(dt);
    const w = this.world;
    if (!w || (!this.ragdolls.length && !this.dynamicItems.awake && !this.chunks.awake && !this.sourcesAwake)) {
      this.stepMs *= 0.9;
      // resting chunks still fade / expire, walkers can still shove resting loose props
      this.chunks.update(dt);
      this.dynamicItems.update(dt);
      for (const s of this.sources) s.update?.(dt);
      return;
    }
    const t0 = performance.now();
    this.chunkTimer -= dt;
    if (this.chunkTimer <= 0) this.refreshChunks();
    w.step(FIXED_DT, dt, MAX_SUBSTEPS);
    for (const r of this.ragdolls.slice()) {
      if (r.update(dt)) this.retire(r);
      else r.sync(true);
    }
    this.dynamicItems.update(dt);
    this.chunks.update(dt);
    for (const s of this.sources) s.update?.(dt);
    if (!this.ragdolls.length && !this.dynamicItems.awake && !this.chunks.awake && !this.sourcesAwake) this.refreshChunks();
    const ms = performance.now() - t0;
    this.stepMs += (ms - this.stepMs) * 0.1;
    this.stepMsMax = Math.max(this.stepMsMax * 0.995, ms);
  }

  // -------------------------------------------------------------------------------------------
  // Lane LIFT: dynamic volumes (the moving elevator cab)

  /** Volumes registered on the station's Levels; their cannon bodies follow them, riders ride along. */
  private syncVolumes(): void {
    const q = this.query, w = this.world;
    if (!q || !w) return;
    const L = q.levels;
    if (L.volumeVersion !== this.volVersion) {
      this.volVersion = L.volumeVersion;
      // the static boxes around the shaft depend on the volumes: rebuild cached chunks lazily, new cab bodies
      for (const c of this.staticChunks.values()) if (c.active) for (const b of c.bodies) w.removeBody(b);
      this.staticChunks.clear();
      for (const cab of this.cabs.values()) { w.removeBody(cab.body); for (const f of cab.fillers) if (f.inWorld) w.removeBody(f.body); }
      this.cabs.clear();
      this.chunkTimer = 0;
    }
    const vols = L.dynamicVolumes;
    if (!vols.length) return;
    for (const v of vols) {
      let cab = this.cabs.get(v);
      if (!cab) { cab = this.makeCab(v); this.cabs.set(v, cab); }
      const dy = v.floorY - cab.last;
      if (dy !== 0) this.carryRiders(v, cab.last, cab.lastCeil, dy);
      cab.last = v.floorY; cab.lastCeil = v.ceilY;
      const b = cab.body;
      b.position.set((v.x0 + v.x1) / 2, v.floorY, (v.z0 + v.z1) / 2);
      b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position);
      b.velocity.setZero();
      b.aabbNeedsUpdate = true;
      for (const f of cab.fillers) {
        const want = !(f.gate.open && Math.abs(v.floorY - f.stop) < 0.05);
        if (want === f.inWorld) continue;
        if (want) { this.clearDoorway(doorwayMover(v, f.gate, f.stop), gateRect(v, f.gate)); w.addBody(f.body); } else w.removeBody(f.body);
        f.inWorld = want;
      }
      this.keepAboveCabFloor(v);
    }
  }

  /**
   * Safety net: a simulating body whose centre is inside the cab footprint never stays below the cab floor (a deep contact
   * or a frame hitch can push it into the slab): it is put back on the floor, not let through into the shaft.
   */
  private keepAboveCabFloor(v: DynamicVolume): void {
    for (const b of this.world!.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const p = b.position;
      if (p.x <= v.x0 || p.x >= v.x1 || p.z <= v.z0 || p.z >= v.z1 || p.y > v.floorY + 0.6 || p.y < v.floorY - CAB_SLAB - 0.3) continue;
      if (b.aabbNeedsUpdate) b.updateAABB();
      const low = b.aabb.lowerBound.y;
      if (low >= v.floorY - 0.02) continue;
      const lift = v.floorY - low + 0.001;
      p.y += lift; b.previousPosition.y += lift; b.interpolatedPosition.y += lift;
      if (b.velocity.y < 0) b.velocity.y = 0;
      b.aabbNeedsUpdate = true;
      this.cabClamps++;
    }
  }

  /** The cab's kinematic floor + ceiling slabs and one doorway filler per gate and stop. */
  private makeCab(v: DynamicVolume): CabBodies {
    const w = this.world!;
    const ALL = GROUP_RAGDOLL | GROUP_ITEM | GROUP_CHUNK;
    const hx = (v.x1 - v.x0) / 2, hz = (v.z1 - v.z0) / 2, h = v.ceilY - v.floorY;
    const body = new CANNON.Body({mass: 0, type: CANNON.Body.KINEMATIC, material: this.staticMat, collisionFilterGroup: GROUP_STATIC, collisionFilterMask: ALL});
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx + 0.05, CAB_SLAB / 2, hz + 0.05)), new CANNON.Vec3(0, -CAB_SLAB / 2, 0));
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx + 0.05, CAB_SLAB / 2, hz + 0.05)), new CANNON.Vec3(0, h + CAB_SLAB / 2, 0));
    body.position.set((v.x0 + v.x1) / 2, v.floorY, (v.z0 + v.z1) / 2);
    w.addBody(body);
    const fillers: CabBodies['fillers'] = [];
    for (const g of v.gates) {
      const r = gateRect(v, g);
      for (const stop of v.stops ?? [v.floorY]) {
        const fb = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC, material: this.staticMat, collisionFilterGroup: GROUP_STATIC, collisionFilterMask: ALL});
        fb.addShape(new CANNON.Box(new CANNON.Vec3((r.x1 - r.x0) / 2, g.height / 2, (r.z1 - r.z0) / 2)));
        fb.position.set((r.x0 + r.x1) / 2, stop + g.height / 2, (r.z0 + r.z1) / 2);
        fb.aabbNeedsUpdate = true;
        fillers.push({body: fb, gate: g, stop, inWorld: false});
      }
    }
    return {body, last: v.floorY, lastCeil: v.ceilY, fillers};
  }

  /** The landing doors shut on a doorway: simulating bodies and resting things in it go to the nearer side (never left inside the wall). */
  private clearDoorway(move: DoorwayMove, area?: {x0: number; z0: number; x1: number; z1: number}): void {
    for (const b of this.world!.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const p = b.position, to = move(p.x, p.y, p.z);
      if (!to) continue;
      const dx = to[0] - p.x, dz = to[1] - p.z;
      p.x += dx; p.z += dz; b.previousPosition.x += dx; b.previousPosition.z += dz; b.interpolatedPosition.x += dx; b.interpolatedPosition.z += dz;
      b.aabbNeedsUpdate = true;
    }
    this.dynamicItems.relocate(move, area); // task office-interactions-layout-20261030 (lane PHYS): resting loose props (static bodies)
    this.casings.relocate(move);
    this.chunks.relocate(move);
    for (const s of this.sources) s.relocate?.(move);
  }

  /** Everything resting / moving inside the cab rides its dy (the cab frame stays exact). */
  private carryRiders(v: DynamicVolume, floor: number, ceil: number, dy: number): void {
    const w = this.world!;
    // task office-interactions-layout-20261030 (lane PHYS): resting loose props (static bodies) ride too — first, while the
    // simulating bodies below are still at their pre-move positions (their placement height follows either way)
    this.dynamicItems.carry((x, y, z) => inCab(v, floor, ceil, x, y, z), dy, {x0: v.x0 - RIDE_PAD, z0: v.z0 - RIDE_PAD, x1: v.x1 + RIDE_PAD, z1: v.z1 + RIDE_PAD});
    const shift = (b: CANNON.Body) => {
      b.position.y += dy; b.previousPosition.y += dy; b.interpolatedPosition.y += dy;
      b.aabbNeedsUpdate = true;
    };
    for (const b of w.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const p = b.position;
      if (inCab(v, floor, ceil, p.x, p.y, p.z)) shift(b);
    }
    // corpses no longer simulating: their bones are posed relative to the actor root
    for (const r of this.frozen) {
      const p = r.pelvis.position;
      if (!inCab(v, floor, ceil, p.x, p.y, p.z)) continue;
      for (const part of r.parts) part.body.position.y += dy;
      const root = (r.target as {root?: THREE.Object3D}).root;
      if (root) { root.position.y += dy; root.updateMatrixWorld(true); }
    }
    const test = (x: number, y: number, z: number) => inCab(v, floor, ceil, x, y, z);
    this.casings.carry(test, dy);
    this.chunks.carry(test, dy);
    for (const s of this.sources) s.carry?.(test, dy);
  }

  /** QA / tests: the cannon bodies of the dynamic volumes. */
  cabBodies(): {floor: number; fillersIn: number; fillers: number}[] {
    return [...this.cabs.values()].map(c => ({floor: c.body.position.y, fillersIn: c.fillers.filter(f => f.inWorld).length, fillers: c.fillers.length}));
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
    const around = (p: {x: number; z: number}, rad: number) => {
      const x0 = Math.floor((p.x - rad) / span), x1 = Math.floor((p.x + rad) / span);
      const y0 = Math.floor((p.z - rad) / span), y1 = Math.floor((p.z + rad) / span);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) need.add(this.chunkKey(cx, cy));
    };
    for (const r of this.ragdolls) around(r.pelvis.position, ACTIVE_RADIUS);
    const pts: CANNON.Vec3[] = [];
    this.dynamicItems.activePoints(pts);
    this.chunks.activePoints(pts);
    for (const s of this.sources) s.activePoints(pts);
    for (const p of pts) if (Number.isFinite(p.x + p.z)) around(p, BODY_RADIUS);
    // task office-props-physics-scale-20261030 (lane PHYS): resting loose props (static bodies) come and go with their chunk
    for (const [k, c] of this.staticChunks) {
      if (c.active && !need.has(k)) { for (const b of c.bodies) w.removeBody(b); c.active = false; this.dynamicItems.chunkToggled(k, false); }
    }
    for (const k of need) {
      let c = this.staticChunks.get(k);
      if (!c) { c = {bodies: this.buildChunk(k), active: false}; this.staticChunks.set(k, c); }
      if (!c.active) { for (const b of c.bodies) w.addBody(b); c.active = true; this.dynamicItems.chunkToggled(k, true); }
    }
  }

  /** Greedy-merge one chunk's cells into boxes by vertical profile (floor height), plus stair treads and props. */
  private buildChunk(key: number): CANNON.Body[] {
    const q = this.query!;
    const cx0 = (key % 8192 - 4096) * CHUNK, cy0 = (Math.floor(key / 8192) - 4096) * CHUNK;
    const base = q.minFloor - 0.5;
    const WALL_TOP = q.topY;
    const used = new Uint8Array(CHUNK * CHUNK);
    // iteration 08: per-column multi-level profile keys (single level: wall / ramp / floor height, as before)
    const keys: string[] = [];
    // lane LIFT: elevator columns. Below the shaft each keeps its grid profile (e.g. a station hall under the tower); over
    // the shaft's height the cab interior is free (its kinematic slabs move with it, roofed above the top stop), the shaft
    // walls ('ring') are solid, every doorway column is solid except an opening per stop (filled while shut).
    const vrs: (ReturnType<StaticQuery['volumeRole']>)[] = [];
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const vr = q.volumeRole(cx0 + x, cy0 + y);
      vrs.push(vr);
      keys.push(vr ? `v${vr.role[0]}${vr.role === 'gate' ? `${x},${y}` : ''}:${q.columnKey(cx0 + x, cy0 + y, base)}` : q.columnKey(cx0 + x, cy0 + y, base));
    }
    const cls = (x: number, y: number) => keys[y * CHUNK + x];
    const bodies: CANNON.Body[] = [];
    const ALL = GROUP_RAGDOLL | GROUP_ITEM | GROUP_CHUNK;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mask = ALL) => {
      const b = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC, material: this.staticMat, collisionFilterGroup: GROUP_STATIC, collisionFilterMask: mask});
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
        if (c === 'w') { box(X0, X1, base - 0.1, WALL_TOP, Z0, Z1); continue; }
        const vr = vrs[y * CHUNK + x];
        if (vr) {
          const [sb, st] = StaticQuery.shaftRange(vr.v, CAB_SLAB);
          // under the shaft: the column's own grid profile, clipped below the shaft (a wall column: solid up to it)
          const prof = q.columnSolids(cx0 + x, cy0 + y, base);
          if (prof.wall) box(X0, X1, base - 0.1, sb, Z0, Z1);
          else for (const so of prof.solids) if (so.y0 < sb - 1e-3) box(X0, X1, so.y0, Math.min(so.y1, sb), Z0, Z1);
          if (vr.role === 'cab') { if (WALL_TOP > st + 1e-3) box(X0, X1, st, WALL_TOP, Z0, Z1); continue; }
          if (vr.role === 'ring') { box(X0, X1, sb, WALL_TOP, Z0, Z1); continue; }
          const gate = vr.col!.gate!, stops = [...(vr.v.stops ?? [vr.v.floorY])].sort((a, b) => a - b);
          let below = sb;
          for (const s of stops) { if (s > below + 1e-3) box(X0, X1, below, s, Z0, Z1); below = Math.max(below, s + gate.height); }
          if (WALL_TOP > below + 1e-3) box(X0, X1, below, WALL_TOP, Z0, Z1);
          continue;
        }
        // floors / slabs between storeys (stair ramp columns: only the slabs not under the flight; treads below)
        for (const s of q.columnSolids(cx0 + x, cy0 + y, base).solids) box(X0, X1, s.y0, s.y1, Z0, Z1);
      }
    }
    const span = CHUNK * CELL;
    // Stair steps (tread tops) whose centre lies in this chunk: ragdolls rest on the treads.
    for (const {ramp: r, bottom} of q.ramps(base)) {
      for (const p of rampPieces(r)) {
        const sm = (p.s0 + p.s1) / 2, am = (p.a0 + p.a1) / 2;
        const wx = r.axis === 'x' ? sm : am, wz = r.axis === 'x' ? am : sm;
        if (Math.floor(wx / span) !== cx0 / CHUNK || Math.floor(wz / span) !== cy0 / CHUNK) continue;
        if (p.h - bottom < 0.02) continue;
        if (r.axis === 'x') box(p.s0, p.s1, bottom, p.h, p.a0, p.a1);
        else box(p.a0, p.a1, bottom, p.h, p.s0, p.s1);
      }
    }
    // Iteration 08: railings (deck edges, stairwells, flight sides) — sloped runs in 0.5 m slices
    for (const rl of q.rails) {
      const len = Math.hypot(rl.x1 - rl.x0, rl.z1 - rl.z0);
      // flat runs are sliced too: a run's slice is only built with the chunk holding its midpoint, so one long unsliced deck-edge
      // rail existed only around its middle (Meshy T2.5 migration 2026-10-29: stock knocked off a deck end passed through it)
      const n = Math.max(1, Math.round(len / CELL));
      for (let k = 0; k < n; k++) {
        const a = k / n, b = (k + 1) / n;
        const xa = rl.x0 + (rl.x1 - rl.x0) * a, xb = rl.x0 + (rl.x1 - rl.x0) * b, za = rl.z0 + (rl.z1 - rl.z0) * a, zb = rl.z0 + (rl.z1 - rl.z0) * b;
        const mx = (xa + xb) / 2, mz = (za + zb) / 2;
        if (Math.floor(mx / span) !== cx0 / CHUNK || Math.floor(mz / span) !== cy0 / CHUNK) continue;
        const ya = rl.y0 + (rl.y1 - rl.y0) * a, yb = rl.y0 + (rl.y1 - rl.y0) * b;
        box(Math.min(xa, xb) - RAIL_HALF, Math.max(xa, xb) + RAIL_HALF, Math.min(ya, yb), Math.max(ya, yb) + (rl.h ?? RAIL_H), Math.min(za, zb) - RAIL_HALF, Math.max(za, zb) + RAIL_HALF);
      }
    }
    for (const p of q.props) {
      if (Math.floor(p.x / span) !== cx0 / CHUNK || Math.floor(p.z / span) !== cy0 / CHUNK) continue;
      if (p.h <= 0.02 || p.hx <= 0 || p.hz <= 0) continue;
      // Iteration 07: loot holders are solid for ragdolls, but items / chunks rest on their real shelves
      const hb = this.holderBoxes?.(p) ?? null;
      if (!hb) { box(p.x - p.hx, p.x + p.hx, p.y, p.y + p.h, p.z - p.hz, p.z + p.hz); continue; }
      box(p.x - p.hx, p.x + p.hx, p.y, p.y + p.h, p.z - p.hz, p.z + p.hz, GROUP_RAGDOLL);
      for (const b of hb) box(b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z, GROUP_ITEM | GROUP_CHUNK);
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
    const c = this.staticChunks.get(key);
    if (!c) return;
    if (c.active && this.world) for (const b of c.bodies) this.world.removeBody(b);
    if (c.active) this.dynamicItems.chunkToggled(key, false); // lane PHYS: its resting loose props leave with it (refresh re-adds)
    this.staticChunks.delete(key);
    if (c.active) this.refreshChunks();
  }

  // -------------------------------------------------------------------------------------------
  stats(): PhysicsStats {
    let staticBodies = 0;
    for (const c of this.staticChunks.values()) if (c.active) staticBodies += c.bodies.length;
    return {
      ragdollsActive: this.ragdolls.length,
      ragdollsFrozen: this.frozen.length,
      ragdollsFailed: this.failedCount,
      casingsLive: this.casings.live,
      bodies: this.world?.bodies.length ?? 0,
      staticBodies,
      stepMs: Math.round(this.stepMs * 1000) / 1000,
      stepMsMax: Math.round(this.stepMsMax * 1000) / 1000,
      dynamic: this.dynamicItems.stats(),
      chunks: this.chunks.stats(),
    };
  }

  /**
   * World velocity of an actor's body at a point: the nearest simulating ragdoll part (linear +
   * angular), else false (caller uses the animated bone velocity).
   */
  actorVelocity(target: object, point: THREE.Vector3, out: THREE.Vector3): boolean {
    const r = this.ragdolls.find(x => x.target === target);
    if (!r) return false;
    let best: CANNON.Body | null = null, bd = Infinity;
    for (const p of r.parts) { const d = p.body.position.distanceTo(new CANNON.Vec3(point.x, point.y, point.z)); if (d < bd) { bd = d; best = p.body; } }
    if (!best) return false;
    const rel = new CANNON.Vec3(point.x - best.position.x, point.y - best.position.y, point.z - best.position.z);
    const v = best.angularVelocity.cross(rel).vadd(best.velocity);
    out.set(v.x, v.y, v.z);
    return true;
  }

  /** QA: simulating ragdolls' pelvis positions. */
  debugRagdolls(): {x: number; y: number; z: number; age: number; frozen: boolean}[] {
    return [...this.ragdolls, ...this.frozen].map(r => ({x: r.pelvis.position.x, y: r.pelvis.position.y, z: r.pelvis.position.z, age: r.age, frozen: r.frozen}));
  }
}
