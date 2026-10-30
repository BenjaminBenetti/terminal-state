// Iteration 07 (Lane K): shot impulses on physical things — loose items, loot lots and light props.
//
// Activate-on-hit rigid bodies in the station's bounded cannon-es world (physics/world.ts):
//  - ITEMS (world pickups; a visible loot lot is first lifted off its holder into a pickup with the
//    SAME item id / count, its lot id kept as provenance — containers.ts detachLot): a collider
//    from the item model's own bounds (upright cylinder for cans / bottles / cups, box otherwise)
//    and mass per item (damage/materials.ts ITEM_PHYSICS). A bullet applies an impulse AT the hit
//    point (so off-centre hits spin / tip / roll it) plus a small lift; contacts with floors at every
//    cell height, stair treads, track beds, walls, prop boxes, loot-holder shelves (holderShapes.ts),
//    other items and chunks. The pickup's render transform, its targeting anchor (p.x/y/z) and its
//    highlight follow the body; when it sleeps the body is removed and the pickup simply rests there.
//  - LIGHT PROPS (PROP_PHYSICS / PROP_DEFS.physics `dynamic`, e.g. trash cans): the prop is detached
//    from shared rendering (PropDamage.detach), becomes a body, stops blocking walking / hitscan as an
//    AABB (h = 0; it is hit-tested here as an oriented box) and walkers shove it. Asleep it turns into
//    a STATIC body at its final pose (other items / chunks / ragdolls still collide with it).
// Budget: at most MAX_DYNAMIC_ITEMS item bodies and MAX_DYNAMIC_PROPS prop bodies simulate at once.
// Over budget the oldest is retired if nearly at rest, otherwise FROZEN in place (never deleted —
// gameplay loot) and re-activated with its saved velocity as soon as a slot frees.
//
// Task office-interactions-layout-20261030 (lane PHYS): the office's movable furniture (gen/office/physics.ts OFFICE_PHYS ->
// PROP_PHYSICS; every kind classified in damage/physicsAudit.ts PROP_PHYSICS_AUDIT). In office (tower) worlds only
// (`contactOn`: StaticQuery.capAbove, or the `contactWake` override) — the Subway keeps exactly its iteration-07 / 08 rules
// [superseded by task office-props-physics-scale-20261030 below: contact wake in every world, the Subway kinds calibrated]:
//  - CONTACT WAKE: a walker moving into a light dynamic floor prop of a `contact` kind (the office kinds, calibrated castor / pad
//    contacts) wakes it (not only a shot): within CONTACT_MARGIN of its box and heading for it, the prop goes loose (static body,
//    no AABB) and the walker shove moves it from then on (iteration-07 kinds placed in the office keep the shot-first rule: their
//    sticky Subway contacts make a shoved body tip and the walker pass into it). Wakers: walkers
//    flagged `wake` (the player) and walkers within CONTACT_RANGE of one (zombies near the player) — never far-away AI, never a
//    loot holder, and only while the damage system has CONTACT_RESERVE detach slots left (shot marks keep their headroom).
//  - ON-HOST decor (`onHost`, the office monitor) goes loose on its static host's top: a host-top support slab is added for it
//    (the desk's loot surface is split around the monitor, so its shelf boxes leave a gap exactly there).
//  - a moving prop knocks resting lots / pickups it touches like a flying item does (lots lifted as the same pickups); walkers
//    do not shove a raised prop (a monitor on a desk) with their legs; a prop something rests on never goes loose; a walker
//    shove closes OFFICE_SHOVE_GAIN of the speed gap per frame (calibrated carpet friction: the walker stays out of a 20 kg
//    armchair) and pushes within the body's own height (a low bean bag is not flipped).
//  - riders: resting (static-body) loose props inside the moving elevator cab ride its dy, and are swept out of a doorway the
//    landing doors shut on (PhysicsSystem.carryRiders / clearDoorway call carry() / relocate()).
//
// Task office-props-physics-scale-20261030 (lane PHYS; user: "All physics objects should always be interactable, without needing to
// be shot first"):
//  - CONTACT WAKE IN EVERY WORLD: the Subway's light kinds carry calibrated castor / pad contacts too (damage/materials.ts
//    SUBWAY_CONTACT), so walking into a suitcase, stroller, chair, sign … wakes it in the Subway and in the Office (imported kinds)
//    exactly like the office furniture. A `contact` kind follows the office shove rules in every world; the iteration-07 kinds left
//    uncalibrated (the trash can) keep their world's rules. Holders still wake by shots only; the placement rules (on the floor or
//    an on-host decor, nothing resting on it) hold in every world.
//  - DETACH SLOTS ARE RECLAIMED: a resting loose prop (static body, also a budget-frozen one) can hand its own meshes back to its
//    shared instances AT ITS CURRENT POSE (damage/propDamage.ts reattach: instance matrix = its drawn pose, no pop, its material
//    clones dropped) and stays loose (entity, body, pose kept: walking into it / shooting it re-detaches it and moves it again).
//    Reclaimed lazily — in the background while fewer than CONTACT_RESERVE + RECLAIM_AHEAD soft slots are left, and on demand
//    when a wake needs a slot — oldest at rest first, a bullet-marked one only far from the player (its marks go), then the damage
//    system's own far marked props. So the detach budget never runs out for good.
//  - BOUNDED WORK: the simulating bodies are a set (no per-frame scan of every entity); resting loose props are indexed by their
//    4 m static collision chunk (chunks.ts staticChunkKey) and their static bodies join the cannon world only while that chunk is
//    active (PhysicsSystem.refreshChunks -> chunkToggled), like the station statics — SAP's pair loop is quadratic in static bodies.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {rayAabb, type Vec3} from '../combat/hitscan';
import {itemPhysics, propPhysics, type PhysMat} from '../damage/materials';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {isLootHolderKind} from '../items/loot';
import {isSpillHolderKind} from '../world/openablesSpec';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_RAGDOLL, GROUP_STATIC} from './ragdoll';
import {STATIC_CHUNK_M, groundClamp, restTime, staticChunkKey, type BodyHost, type ImpactFamily} from './chunks';
import type {StaticQuery} from './staticQuery';

export const MAX_DYNAMIC_ITEMS = 16;
export const MAX_DYNAMIC_PROPS = 4;
/** Lane PHYS: a walker this close to a prop box (beyond its radius, m) and heading for it wakes it. */
export const CONTACT_MARGIN = 0.12;
/** Lane PHYS: contact wakes stop while fewer soft detach slots than this remain (bullet damage marks keep their headroom). */
export const CONTACT_RESERVE = 16;
/** Lane PHYS: AI walkers wake props by contact only within this distance of a `wake` walker (the player), m. */
export const CONTACT_RANGE = 10;
/** Task office-props-physics-scale-20261030 (lane PHYS): background reclaim keeps this many soft detach slots above CONTACT_RESERVE. */
export const RECLAIM_AHEAD = 8;
/** Lane PHYS: a bullet-marked prop is reclaimed (its marks dropped) only this far from every `wake` walker (m; another storey: far). */
export const RECLAIM_MARK_FAR = 25;
/** Lane PHYS: candidates looked at per reclaim call (bounded work). */
const RECLAIM_CHECKS = 8;
/** Lane PHYS: entities swept per frame for taken pickups (round robin; simulating ones are checked every frame). */
const SWEEP_PER_FRAME = 8;
/** Lane PHYS: a box collider may start this deep inside a static neighbour's box before it is clipped (m). */
const START_PEN = 0.02;
/** Lane PHYS (office worlds): a loose prop whose bottom is this far above a walker's feet is out of reach of its legs (m). */
const RAISED_SHOVE = 0.5;
/** Lane PHYS (office worlds): a moving prop faster than this knocks resting lots / pickups it touches (m/s). */
const PROP_KNOCK_SPEED = 0.5;
/** Lane PHYS: contact-wake candidate buckets (m). */
const CB = 1;
/** Lane PHYS (office worlds): share of the walker-speed gap a shove closes per frame (the Subway keeps 0.35). */
const OFFICE_SHOVE_GAIN = 0.6;

/**
 * Whether props of this kind can become rigid bodies at all: flagged dynamic (PROP_PHYSICS / PROP_DEFS.physics) with a finite
 * mass, and not a loot holder (its lots would float) unless it is a spill holder (trash can / wheelie bin: goLoose spills them).
 * Placement rules come on top (DynamicItems.isDynamicProp: on the floor, or on a static host for `onHost` kinds).
 */
export function dynamicKind(kind: string): boolean {
  const ph = propPhysics(kind);
  return ph.dynamic && Number.isFinite(ph.mass) && !(isLootHolderKind(kind) && !isSpillHolderKind(kind));
}
/** Largest velocity change one bullet gives a light item (m/s) and spin cap (rad/s). */
export const MAX_SHOT_DV = 5.5;
const MAX_SPIN = 40;
const RETIRE_SLEEP = 0.3;
const ITEM_MASK = GROUP_STATIC | GROUP_ITEM | GROUP_CHUNK;

/** A world pickup as the physics sees it (world/pickups.ts Pickup). */
export interface PickupLike {
  stack: {itemId: string; uid?: number; count: number};
  x: number; y: number; z: number;
  obj: THREE.Object3D;
}

/**
 * A walker that shoves loose props (player, zombies); id = any stable object. Lane PHYS: `wake` = it wakes light props by
 * walking into them in office worlds (the player); other walkers do so only near a waking one.
 */
export interface Walker { id: object; x: number; z: number; y: number; r: number; wake?: boolean }

/** Lane PHYS (task office-props-physics-scale-20261030): outcome of PropDetacher.reattach. */
export type ReattachResult = 'ok' | 'marked' | 'never';

/** What dynamic props need from the prop damage system (damage/propDamage.ts). */
export interface PropDetacher {
  /** Detach the prop's render instances into its own meshes (marks them moving); null if impossible. */
  detachForPhysics(prop: PropPlacement, index: number): THREE.Mesh[] | null;
  /** Lane PHYS: soft detach slots left (contact wakes keep CONTACT_RESERVE of them for bullet marks); absent = unlimited. */
  detachRoom?(): number;
  /**
   * Task office-props-physics-scale-20261030 (lane PHYS): hand a resting loose prop's own meshes back to its shared instances at
   * their current pose (its slot freed). 'marked': it has bullet marks and `dropMarks` is false; 'never': it cannot (broken, glass
   * gone, moved merged-mesh triangles, nothing detached). Absent: nothing is ever reclaimed.
   */
  reattach?(prop: PropPlacement, dropMarks: boolean): ReattachResult;
  /** Lane PHYS: reclaim up to `n` of the damage system's own (non-physics) marked props for which `far` holds; returns slots freed. */
  reclaimMarked?(far: (x: number, y: number, z: number) => boolean, n: number): number;
}

interface Ent {
  kind: 'item' | 'prop';
  serial: number;
  body: CANNON.Body | null;
  /** Frozen while still moving (budget): re-activated with the saved velocity when a slot frees. */
  pending: {v: CANNON.Vec3; w: CANNON.Vec3} | null;
  /** Collider centre in the object frame (items: model frame, origin bottom-centre). */
  center: THREE.Vector3;
  half: THREE.Vector3;
  shape: 'box' | 'cylinder';
  mass: number;
  mat: PhysMat;
  fam: ImpactFamily;
  t: number;
  sleepT: number;
  soundT: number;
  shots: number;
  pickup?: PickupLike;
  prop?: PropPlacement;
  propIndex?: number;
  /**
   * Iteration 08 (Lane I): any object driven by its world `matrix` (detached meshes, an openable holder's own root). Task
   * office-props-physics-scale-20261030 (lane PHYS): undefined on a loose prop whose render was reattached (reclaimed); waking
   * it detaches it again.
   */
  parts?: {mesh: THREE.Object3D; rel: THREE.Matrix4}[];
  /** Lane PHYS: a calibrated `contact` kind (castor / pad): office shove / knock-on rules in every world. */
  contact?: boolean;
  /** Lane PHYS: rest-index key (chunks.ts staticChunkKey) while a prop's body is static, else null. */
  restKey?: number | null;
  /** Lane PHYS: bounding radius of the collider (m). */
  rad?: number;
}

export interface DynHit { t: number; point: THREE.Vector3; normal: THREE.Vector3; pickup?: PickupLike; prop?: PropPlacement; propIndex?: number; ent?: Ent }

const tm = new THREE.Matrix4(), tm2 = new THREE.Matrix4(), tv = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(1, 1, 1);
const cv = new CANNON.Vec3(), cv2 = new CANNON.Vec3();
const boundsCache = new Map<string, {center: THREE.Vector3; half: THREE.Vector3}>();

/** Bounds of an object in its own frame (all meshes, current local transforms). */
export function localBounds(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const inv = tm2.copy(obj.matrixWorld).invert();
  const box = new THREE.Box3();
  obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(tm.multiplyMatrices(inv, m.matrixWorld)));
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, 0, -0.05), new THREE.Vector3(0.05, 0.1, 0.05));
  return box;
}

/** World AABB of an oriented box (object matrix, local centre / half extents). */
function obbBox(m: THREE.Matrix4, c: THREE.Vector3, h: THREE.Vector3, out: THREE.Box3): THREE.Box3 {
  const e = m.elements;
  const cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], cy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13], cz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
  const ex = Math.abs(e[0]) * h.x + Math.abs(e[4]) * h.y + Math.abs(e[8]) * h.z;
  const ey = Math.abs(e[1]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[9]) * h.z;
  const ez = Math.abs(e[2]) * h.x + Math.abs(e[6]) * h.y + Math.abs(e[10]) * h.z;
  out.min.set(cx - ex, cy - ey, cz - ez);
  out.max.set(cx + ex, cy + ey, cz + ez);
  return out;
}

const FAM: Record<PhysMat, ImpactFamily> = {metal: 'can', plastic: 'light', soft: 'light', heavy: 'heavy', stone: 'stone', wood: 'wood', glass: 'glass', flesh: 'flesh', cloth: 'flesh', castor: 'heavy', pad: 'light'};

export class DynamicItems {
  private readonly ents = new Map<object, Ent>();
  private serial = 0;
  /** Walkers (player, zombies) that shove loose props; set by the game per station. */
  walkers: (() => readonly Walker[]) | null = null;
  /** Detaches a dynamic prop's render instances (set by the damage system). */
  detacher: PropDetacher | null = null;
  /** Loose pickups of the station: resting ones are knocked on when a moving item touches them. */
  pickups: (() => readonly PickupLike[]) | null = null;
  /** Lift the visible loot lots overlapping a box off their holders (as pickups) — a flying can knocks its neighbours over. */
  liftLots: ((box: THREE.Box3) => PickupLike[]) | null = null;
  /**
   * Iteration 08 (Lane I): a light loot holder (trash can / wheelie bin) goes loose: the holder system spills its finite lots and
   * returns its own objects (lid, liner; world-matrix driven) for the body to carry along with the detached meshes.
   */
  holderLoose: ((prop: PropPlacement) => THREE.Object3D[]) | null = null;
  private readonly lastPos = new WeakMap<object, {x: number; z: number}>();
  /**
   * Lane PHYS: contact wake + office-world interaction rules. Task office-props-physics-scale-20261030: null = automatic — contact
   * wake in EVERY world (contactOn), the office rules for uncalibrated kinds (prop knock-on, shove gain / height, no leg shove of
   * raised props) in tower worlds (StaticQuery.capAbove: a level with role 'office'); `contact` kinds follow those rules everywhere.
   * true = both on (tests emulate an office room with it); false = both off. Tests / QA may force it.
   */
  contactWake: boolean | null = null;
  /** Lane PHYS: contact-wake candidates (prop indices per CB-metre bucket) of the current statics. */
  private contactIndex: {statics: StaticQuery; cells: Map<number, number[]>} | null = null;
  private readonly scanSeen = new Set<number>();
  /** Lane PHYS: support slabs added under on-host props' hosts (host prop -> static body). */
  private readonly hostSlabs = new Map<PropPlacement, CANNON.Body>();
  /** Lane PHYS: props that something rests on (never go loose: no floating stacks). */
  private readonly supportsMemo = new WeakMap<PropPlacement, boolean>();
  /** Task office-props-physics-scale-20261030 (lane PHYS): entities with a SIMULATING (dynamic) body. */
  private readonly active = new Set<Ent>();
  /** Lane PHYS: loose props with a static body (resting / budget-frozen) per static chunk key (chunks.ts staticChunkKey). */
  private readonly rest = new Map<number, Set<Ent>>();
  /** Lane PHYS: resting loose props still drawn by their own meshes, oldest at rest first (reclaim candidates). */
  private readonly reclaimQ = new Set<Ent>();
  /** Lane PHYS: budget-frozen entities waiting for a slot. */
  private readonly pendingSet = new Set<Ent>();
  /** Lane PHYS: largest collider radius of any loose prop (walker shove search radius). */
  private maxRad = 0;
  /** Lane PHYS: seconds since the world was built (impact-sound throttle). */
  private clock = 0;
  /** Lane PHYS: positions of the `wake` walkers this frame (x, y, z triples; reclaim distance). */
  private readonly wakePts: number[] = [];
  private sweep: IterableIterator<Ent> | null = null;
  private readonly scratch: Ent[] = [];
  private readonly nearBuf: Ent[] = [];
  /**
   * Counters (QA/tests). Lane PHYS: + contacts (props woken by a walker), carried (cab riders), hostSlabs. Task
   * office-props-physics-scale-20261030: + reclaimed (renders handed back), redetached (reclaimed props woken again), riders
   * (pickups on a prop's top woken with it).
   */
  readonly counts = {activated: 0, shots: 0, retired: 0, frozen: 0, reactivated: 0, pushes: 0, impacts: 0, props: 0, knockOn: 0, clamped: 0, contacts: 0, carried: 0, hostSlabs: 0,
    reclaimed: 0, redetached: 0, riders: 0, clipped: 0};

  /** Lane PHYS: whether walking into a light prop wakes it (see contactWake; task office-props-physics-scale-20261030: every world). */
  get contactOn(): boolean {
    return this.contactWake ?? true;
  }

  /** Lane PHYS: the office-world rules for the uncalibrated (iteration-07) kinds (see contactWake). */
  get officeRules(): boolean {
    return this.contactWake ?? !!this.host.statics?.capAbove;
  }

  constructor(private readonly host: BodyHost) {}

  // ---------------------------------------------------------------------------------------
  private entForPickup(p: PickupLike): Ent {
    let e = this.ents.get(p.obj);
    if (e) { e.pickup = p; return e; }
    const ph = itemPhysics(p.stack.itemId);
    let b = boundsCache.get(p.stack.itemId);
    if (!b) {
      const box = localBounds(p.obj);
      b = {center: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5)};
      boundsCache.set(p.stack.itemId, b);
    }
    e = {kind: 'item', serial: 0, body: null, pending: null, center: b.center.clone(), half: b.half.clone().max(new THREE.Vector3(0.006, 0.006, 0.006)), shape: ph.shape, mass: ph.mass, mat: ph.mat,
      fam: FAM[ph.mat], t: 0, sleepT: 0, soundT: 0, shots: 0, pickup: p};
    this.ents.set(p.obj, e);
    return e;
  }

  /** Object-frame -> world matrix of an entity (items: the pickup object; props: from the body / placement). */
  private objMatrix(e: Ent, out: THREE.Matrix4): THREE.Matrix4 {
    if (e.pickup) { e.pickup.obj.updateMatrixWorld(true); return out.copy(e.pickup.obj.matrixWorld); }
    const b = e.body;
    if (b) return out.compose(tv.set(b.position.x, b.position.y, b.position.z), tq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), ts.set(1, 1, 1)).multiply(tm2.makeTranslation(-e.center.x, -e.center.y, -e.center.z));
    const p = e.prop!;
    return out.compose(tv.set(p.x, p.y, p.z), tq.setFromAxisAngle(tv2.set(0, 1, 0), p.rot), ts.set(1, 1, 1));
  }

  private makeBody(e: Ent, world: THREE.Matrix4): CANNON.Body {
    const body = new CANNON.Body({
      mass: e.mass, material: this.host.material(e.mat), linearDamping: e.kind === 'prop' ? 0.15 : 0.1, angularDamping: e.kind === 'prop' ? 0.6 : e.shape === 'cylinder' ? 0.42 : 0.28,
      collisionFilterGroup: e.kind === 'prop' ? GROUP_STATIC | GROUP_ITEM : GROUP_ITEM, collisionFilterMask: e.kind === 'prop' ? ITEM_MASK | GROUP_RAGDOLL : ITEM_MASK,
      allowSleep: true, sleepSpeedLimit: 0.14, sleepTimeLimit: 0.35,
    });
    const h = e.half;
    if (e.shape === 'cylinder') body.addShape(new CANNON.Cylinder(Math.max(h.x, h.z), Math.max(h.x, h.z), h.y * 2, 12));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(h.x, h.y, h.z)));
    const m = tm.copy(world).multiply(tm2.makeTranslation(e.center.x, e.center.y, e.center.z));
    m.decompose(tv, tq, ts);
    body.position.set(tv.x, tv.y, tv.z);
    body.quaternion.set(tq.x, tq.y, tq.z, tq.w);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.aabbNeedsUpdate = true;
    body.addEventListener('collide', (ev: {contact: CANNON.ContactEquation}) => {
      if (e.soundT > this.clock) return; // lane PHYS: a time stamp (resting entities are no longer ticked every frame)
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (v < 0.75) return;
      e.soundT = this.clock + 0.14;
      this.counts.impacts++;
      this.host.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, e.kind === 'prop' ? 'prop' : e.fam);
    });
    return body;
  }

  private bodies(kind: 'item' | 'prop'): Ent[] {
    const out: Ent[] = [];
    for (const e of this.active) if (e.kind === kind) out.push(e);
    return out;
  }

  get awake(): number {
    return this.active.size;
  }

  /** Positions of simulating bodies (static collision chunks are kept around them). */
  activePoints(out: CANNON.Vec3[]): void {
    for (const e of this.active) out.push(e.body!.position);
  }

  // ---------------------------------------------------------------------------------------
  // Task office-props-physics-scale-20261030 (lane PHYS): the rest index (resting loose props by static chunk) and reclaiming

  /** A loose prop's body went static (resting / frozen): index it by its chunk; it stays in the cannon world only with that chunk. */
  private toRest(e: Ent): void {
    const b = e.body!;
    const key = staticChunkKey(b.position.x, b.position.z);
    if (e.restKey !== key) {
      this.unrest(e);
      let set = this.rest.get(key);
      if (!set) this.rest.set(key, (set = new Set()));
      set.add(e);
      e.restKey = key;
    }
    if (b.world && this.host.chunkActive && !this.host.chunkActive(key)) b.world.removeBody(b);
    else if (!b.world && (!this.host.chunkActive || this.host.chunkActive(key))) this.host.world?.addBody(b);
  }

  private unrest(e: Ent): void {
    if (e.restKey === null || e.restKey === undefined) return;
    const set = this.rest.get(e.restKey);
    set?.delete(e);
    if (set && !set.size) this.rest.delete(e.restKey);
    e.restKey = null;
  }

  /** PhysicsSystem.refreshChunks: static chunk `key` joined / left the world — its resting loose props' bodies follow. */
  chunkToggled(key: number, on: boolean): void {
    const set = this.rest.get(key), w = this.host.world;
    if (!set || !w) return;
    for (const e of set) {
      const b = e.body;
      if (!b || b.type === CANNON.Body.DYNAMIC) continue;
      if (on && !b.world) w.addBody(b);
      else if (!on && b.world) w.removeBody(b);
    }
  }

  /** Loose props whose collider may come within `reach` of (x, z): every simulating one + the rest index around. */
  private looseNear(x: number, z: number, reach: number, out: Ent[]): Ent[] {
    out.length = 0;
    for (const e of this.active) if (e.prop) out.push(e);
    if (!this.rest.size) return out;
    const r = reach + this.maxRad, S = STATIC_CHUNK_M;
    for (let cz = Math.floor((z - r) / S); cz <= Math.floor((z + r) / S); cz++) {
      for (let cx = Math.floor((x - r) / S); cx <= Math.floor((x + r) / S); cx++) {
        const set = this.rest.get((cz + 4096) * 8192 + (cx + 4096));
        if (set) for (const e of set) out.push(e);
      }
    }
    return out;
  }

  /** Lane PHYS: whether (x, y, z) is far from every `wake` walker of this frame (a bullet-marked render may be reclaimed). */
  private farFromWakers(x: number, y: number, z: number): boolean {
    const p = this.wakePts;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 1] - y) < 3 && Math.hypot(p[i] - x, p[i + 2] - z) < RECLAIM_MARK_FAR) return false;
    return true;
  }

  /** Lane PHYS: next to an elevator shaft (its riders / doorway sweep move resting props: keep those drawn by their own meshes). */
  private nearCab(x: number, z: number): boolean {
    for (const v of this.host.statics?.levels.dynamicVolumes ?? []) if (x > v.x0 - 1.5 && x < v.x1 + 1.5 && z > v.z0 - 1.5 && z < v.z1 + 1.5) return true;
    return false;
  }

  /**
   * Lane PHYS: give up to `n` detach slots back. Resting loose props (static bodies, also budget-frozen ones) still drawn by their
   * own meshes hand them back to their shared instances at their current pose (PropDetacher.reattach) and stay loose; oldest at
   * rest first, none beside an elevator shaft. `marks` (on demand: a wake needs the slot now): a bullet-marked one too when far
   * from every `wake` walker (its marks go), then, as the last resort, the damage system's own far marked props. Without it (the
   * background reclaim) marks are never dropped. At most RECLAIM_CHECKS candidates per call. Returns slots freed.
   */
  private reclaim(n: number, except?: Ent, marks = true): number {
    const d = this.detacher;
    if (!d?.reattach || n <= 0) return 0;
    let freed = 0, checks = 0;
    for (const e of this.reclaimQ) {
      if (freed >= n || checks >= RECLAIM_CHECKS) break;
      const b = e.body;
      if (!b || b.type === CANNON.Body.DYNAMIC || !e.parts || !e.prop) { this.reclaimQ.delete(e); continue; }
      if (e === except) continue;
      checks++;
      if (this.nearCab(b.position.x, b.position.z)) continue;
      const r = d.reattach(e.prop, marks && this.farFromWakers(b.position.x, b.position.y, b.position.z));
      if (r === 'marked') { this.reclaimQ.delete(e); this.reclaimQ.add(e); continue; } // kept: to the back, the next call looks further
      this.reclaimQ.delete(e);
      if (r !== 'ok') continue;
      e.parts = undefined;
      freed++;
      this.counts.reclaimed++;
    }
    if (marks && freed < n && d.reclaimMarked) freed += d.reclaimMarked((x, y, z) => this.farFromWakers(x, y, z), n - freed);
    return freed;
  }

  /** Lane PHYS: a reclaimed loose prop is about to move: draw it by its own meshes again (same pose; reclaiming another if full). */
  private redetach(e: Ent): boolean {
    const d = this.detacher, b = e.body, prop = e.prop;
    if (!d || !b || !prop) return false;
    let meshes = d.detachForPhysics(prop, e.propIndex ?? 0);
    if ((!meshes || !meshes.length) && this.reclaim(1, e) > 0) meshes = d.detachForPhysics(prop, e.propIndex ?? 0);
    if (!meshes || !meshes.length) return false;
    const carried = this.holderLoose?.(prop) ?? [];
    const inv = new THREE.Matrix4().compose(tv.set(b.position.x, b.position.y, b.position.z), tq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), ts.set(1, 1, 1)).invert();
    e.parts = [...meshes, ...carried].map(mesh => ({mesh, rel: inv.clone().multiply(mesh.matrix)}));
    this.counts.redetached++;
    return true;
  }

  /**
   * Lane PHYS: background reclaim — keep CONTACT_RESERVE + RECLAIM_AHEAD soft slots free with resting unmarked props (one per frame
   * at most; bullet marks are only ever dropped on demand, when a wake needs the slot).
   */
  private reclaimAhead(): void {
    const room = this.detacher?.detachRoom?.();
    if (room !== undefined && room < CONTACT_RESERVE + RECLAIM_AHEAD && this.reclaimQ.size) this.reclaim(1, undefined, false);
  }

  /** Lane PHYS: a prop starts to move — pickups lying on its top are woken with it (they fall / ride, never float). */
  private wakeRiders(e: Ent): void {
    const b = e.body, list = this.pickups?.();
    if (!b || !list || !list.length) return;
    if (b.aabbNeedsUpdate) b.updateAABB();
    const lb = b.aabb.lowerBound, ub = b.aabb.upperBound;
    let n = 0;
    for (const pk of list) {
      if (n >= 4) break;
      const o = pk.obj.position;
      // on (or in) it above its base: a seat, its top — never one lying on the floor beside / under it
      if (o.x < lb.x - 0.02 || o.x > ub.x + 0.02 || o.z < lb.z - 0.02 || o.z > ub.z + 0.02 || o.y < lb.y + 0.05 || o.y > ub.y + 0.25) continue;
      const it = this.entForPickup(pk);
      if (this.active.has(it)) continue;
      if (this.activate(it)) { this.counts.riders++; n++; }
    }
  }

  /** Make room for one more simulating body of `kind` (retire the oldest at rest, else freeze it). */
  private makeRoom(kind: 'item' | 'prop'): void {
    const max = kind === 'item' ? MAX_DYNAMIC_ITEMS : MAX_DYNAMIC_PROPS;
    const list = this.bodies(kind);
    while (list.length >= max) {
      list.sort((a, b) => a.serial - b.serial);
      const old = list.shift()!;
      const b = old.body!;
      if (b.velocity.length() + b.angularVelocity.length() * 0.05 < 0.35) this.retire(old);
      else { old.pending = {v: b.velocity.clone(), w: b.angularVelocity.clone()}; this.retire(old, true); this.counts.frozen++; }
    }
  }

  /** Start simulating an entity (no-op if it already is). Returns its body (null without a world). */
  private activate(e: Ent): CANNON.Body | null {
    const w = this.host.world;
    if (!w) return null;
    if (e.body && e.body.type === CANNON.Body.DYNAMIC) { e.body.wakeUp(); return e.body; }
    // task office-props-physics-scale-20261030 (lane PHYS): a reclaimed loose prop is drawn by its own meshes again first
    if (e.prop && !e.parts && !this.redetach(e)) return null;
    this.makeRoom(e.kind);
    if (e.body) {
      // a resting loose prop (static body): back to dynamic (lane PHYS: back in the cannon world if its chunk was inactive)
      this.unrest(e);
      this.reclaimQ.delete(e);
      if (!e.body.world) w.addBody(e.body);
      e.body.type = CANNON.Body.DYNAMIC;
      e.body.mass = e.mass;
      e.body.updateMassProperties();
      e.body.wakeUp();
    } else {
      e.body = this.makeBody(e, this.objMatrix(e, new THREE.Matrix4()));
      w.addBody(e.body);
    }
    this.active.add(e);
    this.pendingSet.delete(e);
    e.serial = ++this.serial;
    e.t = 0;
    e.sleepT = 0;
    this.counts.activated++;
    this.host.bodiesChanged();
    if (e.prop) this.wakeRiders(e);
    return e.body;
  }

  /** Stop simulating: items drop their body (rest where they are), props become static bodies (frozen: pose kept, velocity saved in `pending`). */
  private retire(e: Ent, frozen = false): void {
    const b = e.body;
    if (!b) return;
    this.syncEnt(e, false);
    this.active.delete(e);
    // props keep their body as a STATIC obstacle at the current pose (also while frozen by the budget)
    if (e.kind === 'prop') {
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.type = CANNON.Body.STATIC;
      b.mass = 0;
      b.updateMassProperties();
      b.aabbNeedsUpdate = true;
      // lane PHYS: indexed by chunk (in the cannon world only with it), a reclaim candidate while drawn by its own meshes
      this.toRest(e);
      if (e.parts) { this.reclaimQ.delete(e); this.reclaimQ.add(e); }
    } else {
      this.host.world?.removeBody(b);
      e.body = null;
    }
    if (!frozen) { e.pending = null; this.pendingSet.delete(e); } else this.pendingSet.add(e);
    this.counts.retired++;
  }

  // ---------------------------------------------------------------------------------------
  /**
   * Bullet impulse on a pickup (static or already moving): activates it and applies `impulse` N.s
   * along `dir` at the world `point` (+ a small lift), capped at MAX_SHOT_DV / MAX_SPIN.
   */
  shootPickup(p: PickupLike, point: THREE.Vector3, dir: THREE.Vector3, impulse: number): boolean {
    const e = this.entForPickup(p);
    return this.shove(e, point, dir, impulse, 0.28);
  }

  /**
   * Iteration 08 (Lane S): start simulating a pickup without a shot — a loot lot a flying filler piece
   * lifted off its shelf (physics/fillerStock.ts); the contact itself pushes it.
   */
  wakePickup(p: PickupLike): boolean {
    const e = this.entForPickup(p);
    if (!this.activate(e)) return false;
    this.counts.knockOn++;
    return true;
  }

  /** Bullet into a light dynamic prop (first hit detaches it from shared rendering). */
  shootProp(prop: PropPlacement, index: number, point: THREE.Vector3, dir: THREE.Vector3, impulse: number): boolean {
    const e = this.entForProp(prop, index);
    if (!e) return false;
    return this.shove(e, point, dir, impulse, 0.08);
  }

  /**
   * Whether a prop is a light dynamic prop: its kind is flagged (PROP_PHYSICS / PROP_DEFS.physics), it is
   * not a loot holder (its lots would float) and it stands on the floor (not stacked / on a counter / wall-mounted).
   */
  isDynamicProp(prop: PropPlacement): boolean {
    // iteration 08 (Lane I): openable trash cans / wheelie bins are loot holders that still go loose (they spill their lots)
    if (!dynamicKind(prop.kind)) return false;
    if (this.ents.has(prop)) return true;
    const g = this.host.statics?.cellGround(prop.x, prop.z, prop.y + 0.05); // iteration 08: its own storey's floor
    const onFloor = g === undefined || (Number.isFinite(g) && Math.abs(prop.y - g) < 0.06);
    // Lane PHYS: on-host decor may go loose on its static host's top; nothing that carries another prop does (task
    // office-props-physics-scale-20261030: in every world — the Subway wakes by contact too, never leaving a floating stack)
    if (!onFloor && !(propPhysics(prop.kind).onHost && this.restsOnStaticHost(prop))) return false;
    return !this.supportsOther(prop);
  }

  /** Lane PHYS: the prop stands on its host's top face (prop.host), the host is a prop that never moves. */
  private restsOnStaticHost(prop: PropPlacement): boolean {
    const q = prop.host !== undefined ? this.host.statics?.props[prop.host] : undefined;
    if (!q || q === prop || q.h <= 0.02 || dynamicKind(q.kind)) return false;
    return Math.abs(prop.y - (q.y + q.h)) < 0.03 && Math.abs(prop.x - q.x) <= q.hx && Math.abs(prop.z - q.z) <= q.hz;
  }

  /** Lane PHYS: another prop rests on this one's top (it would float if this one moved). */
  private supportsOther(p: PropPlacement): boolean {
    let v = this.supportsMemo.get(p);
    if (v === undefined) {
      const top = p.y + p.h;
      v = (this.host.statics?.props ?? []).some(q => q !== p && q.h > 0.02 && !q.mounted && Math.abs(q.y - top) < 0.06
        && Math.abs(q.x - p.x) < q.hx + p.hx - 0.05 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.05);
      this.supportsMemo.set(p, v);
    }
    return v;
  }

  /** Loose (already physical) props, e.g. for QA. */
  looseProps(): PropPlacement[] {
    return [...this.ents.values()].filter(e => e.prop).map(e => e.prop!);
  }

  private entForProp(prop: PropPlacement, index: number): Ent | null {
    let e = this.ents.get(prop);
    if (e) return e;
    const ph = propPhysics(prop.kind);
    if (!this.isDynamicProp(prop) || prop.h <= 0.02) return null;
    let meshes = this.detacher?.detachForPhysics(prop, index) ?? null;
    // task office-props-physics-scale-20261030 (lane PHYS): the detach budget is full — hand a resting prop's render back first
    if ((!meshes || !meshes.length) && this.reclaim(1) > 0) meshes = this.detacher?.detachForPhysics(prop, index) ?? null;
    if (!meshes || !meshes.length) return null;
    const def = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number} | undefined>)[prop.kind];
    const quarter = Math.round(prop.rot / (Math.PI / 2)) & 1;
    const fit = ph.fit ?? 1; // lane PHYS: chairs' collider inside their box (absent: the box, as before)
    const w = (def?.w ?? (quarter ? prop.hz * 2 : prop.hx * 2)) * fit, d = (def?.d ?? (quarter ? prop.hx * 2 : prop.hz * 2)) * fit, h = prop.h;
    const shape = ph.shape ?? 'box';
    const half = shape === 'cylinder' ? new THREE.Vector3(Math.min(w, d) / 2, h / 2, Math.min(w, d) / 2) : new THREE.Vector3(w / 2, h / 2, d / 2);
    const center = new THREE.Vector3(0, h / 2, 0);
    if (shape === 'box') this.clearStart(prop, center, half);
    e = {kind: 'prop', serial: 0, body: null, pending: null, center, half, shape, mass: ph.mass, mat: ph.mat ?? 'metal', fam: 'prop',
      t: 0, sleepT: 0, soundT: 0, shots: 0, prop, propIndex: index, contact: !!ph.contact, restKey: null, rad: half.length()};
    this.maxRad = Math.max(this.maxRad, e.rad!);
    const body = this.host.world ? this.makeBody(e, this.objMatrix(e, new THREE.Matrix4())) : null;
    if (!body) return null;
    const bm = new THREE.Matrix4().compose(tv.set(body.position.x, body.position.y, body.position.z), tq.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w), ts.set(1, 1, 1));
    const inv = bm.clone().invert();
    const carried = this.holderLoose?.(prop) ?? []; // iteration 08 (Lane I): spill + carry the holder's own lid / liner
    e.parts = [...meshes, ...carried].map(mesh => ({mesh, rel: inv.clone().multiply(mesh.matrix)}));
    // loose from now on: no longer an AABB obstacle for walking / hitscan / statics (hit-tested here)
    prop.h = 0;
    prop.blocksSight = false;
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
    e.body = body;
    this.ents.set(prop, e);
    this.toRest(e); // lane PHYS: a resting loose prop (in the cannon world with its chunk); a walker / bullet activates it next
    this.reclaimQ.add(e);
    this.counts.props++;
    if (ph.onHost) this.hostSupport(prop); // lane PHYS: a monitor on a desk rests on the desk's top
    this.host.propsChanged?.(prop.x, prop.z);
    return e;
  }

  /**
   * Task office-props-physics-scale-20261030 (lane PHYS): a box collider that would START more than START_PEN inside a static
   * neighbour's box (a stacking / folding chair tucked under its table: ~12 cm, more than its `fit` absorbs) is clipped on that
   * side — the face away from it stays where the model is, so the walker still meets it there — instead of popping out of the
   * neighbour when it wakes. One pass over the storey's props when the prop goes loose (an event, not per frame). Office kinds start
   * within START_PEN (tests/office-physics.test.ts), so their colliders are unchanged.
   */
  private clearStart(prop: PropPlacement, center: THREE.Vector3, half: THREE.Vector3): void {
    const props = this.host.statics?.props;
    if (!props) return;
    const c = Math.cos(prop.rot), sn = Math.sin(prop.rot);
    const quarter = Math.abs(sn) > 0.7;
    if (Math.abs(c) > 0.02 && Math.abs(sn) > 0.02) return; // not an axis-aligned quarter turn: leave it
    // the collider's world x / z interval
    let x0 = prop.x - (quarter ? half.z : half.x), x1 = prop.x + (quarter ? half.z : half.x);
    let z0 = prop.z - (quarter ? half.x : half.z), z1 = prop.z + (quarter ? half.x : half.z);
    const ox0 = x0, ox1 = x1, oz0 = z0, oz1 = z1;
    const y0 = prop.y + 0.02, y1 = prop.y + prop.h - 0.02, level = prop.level ?? 0;
    for (const q of props) {
      if (q === prop || q.h <= 0.02 || q.mounted || (q.level ?? 0) !== level || q.y >= y1 || q.y + q.h <= y0) continue;
      const px = Math.min(x1, q.x + q.hx) - Math.max(x0, q.x - q.hx), pz = Math.min(z1, q.z + q.hz) - Math.max(z0, q.z - q.hz);
      if (px <= START_PEN || pz <= START_PEN) continue;
      // clip along the shallower axis, on the neighbour's side
      if (px <= pz) { if (q.x > prop.x) x1 = Math.min(x1, q.x - q.hx + START_PEN); else x0 = Math.max(x0, q.x + q.hx - START_PEN); }
      else if (q.z > prop.z) z1 = Math.min(z1, q.z - q.hz + START_PEN); else z0 = Math.max(z0, q.z + q.hz - START_PEN);
    }
    // never below half of the original footprint (a prop placed deep inside another stays as it was)
    if (x1 - x0 < (ox1 - ox0) * 0.5 || z1 - z0 < (oz1 - oz0) * 0.5 || (x0 === ox0 && x1 === ox1 && z0 === oz0 && z1 === oz1)) return;
    const wx = (x0 + x1) / 2 - prop.x, wz = (z0 + z1) / 2 - prop.z;
    // world offset -> object frame (yaw by -rot)
    center.x = wx * c - wz * sn;
    center.z = wx * sn + wz * c;
    if (quarter) { half.z = (x1 - x0) / 2; half.x = (z1 - z0) / 2; } else { half.x = (x1 - x0) / 2; half.z = (z1 - z0) / 2; }
    this.counts.clipped++;
  }

  /**
   * Lane PHYS: a static slab over the whole top face of an on-host prop's host (items / props / chunks collide with it). The
   * host's holder boxes leave a gap exactly under on-top decor (its loot surface is split round the decor's `cut`), so without
   * it a monitor going loose would drop into its desk. One per host, kept for the world's life (the host never moves).
   */
  private hostSupport(prop: PropPlacement): void {
    const q = prop.host !== undefined ? this.host.statics?.props[prop.host] : undefined;
    const w = this.host.world;
    if (!q || !w || prop.y < q.y + q.h - 0.03 || this.hostSlabs.has(q)) return;
    const T = 0.05;
    const b = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC, material: this.host.staticMaterial ?? this.host.material('heavy'),
      collisionFilterGroup: GROUP_STATIC, collisionFilterMask: GROUP_ITEM | GROUP_CHUNK});
    b.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.02, q.hx - 0.01), T / 2, Math.max(0.02, q.hz - 0.01))));
    b.position.set(q.x, q.y + q.h - T / 2, q.z);
    b.aabbNeedsUpdate = true;
    w.addBody(b);
    this.hostSlabs.set(q, b);
    this.counts.hostSlabs++;
  }

  private shove(e: Ent, point: THREE.Vector3, dir: THREE.Vector3, impulse: number, lift: number): boolean {
    const b = this.activate(e);
    if (!b) return false;
    e.shots++;
    this.counts.shots++;
    let j = impulse;
    if (j / e.mass > MAX_SHOT_DV) j = e.mass * MAX_SHOT_DV;
    const d = tv.copy(dir).normalize();
    cv.set(d.x * j, d.y * j + j * lift, d.z * j);
    cv2.set(point.x - b.position.x, point.y - b.position.y, point.z - b.position.z);
    const reach = Math.max(e.half.x, e.half.y, e.half.z) * 1.2;
    if (cv2.length() > reach) cv2.scale(reach / cv2.length(), cv2);
    b.applyImpulse(cv, cv2);
    const wl = b.angularVelocity.length();
    if (wl > MAX_SPIN) b.angularVelocity.scale(MAX_SPIN / wl, b.angularVelocity);
    b.wakeUp();
    return true;
  }

  // ---------------------------------------------------------------------------------------
  /**
   * Oriented-box ray test against loose items (the given pickups) and loose props, nearest first,
   * before `maxT`. Items are inflated by `pad` (tiny cans are hard to hit otherwise).
   */
  rayHits(o: Vec3, d: Vec3, maxT: number, pickups: readonly PickupLike[], pad = 0.008): DynHit[] {
    const out: DynHit[] = [];
    const O = new THREE.Vector3(o.x, o.y, o.z), D = new THREE.Vector3(d.x, d.y, d.z);
    const test = (m: THREE.Matrix4, center: THREE.Vector3, half: THREE.Vector3, p: number): {t: number; n: THREE.Vector3} | null => {
      const inv = tm2.copy(m).invert();
      const lo = tv.copy(O).applyMatrix4(inv);
      const ld = tv2.copy(D).transformDirection(inv);
      const r = rayAabb({x: lo.x, y: lo.y, z: lo.z}, {x: ld.x, y: ld.y, z: ld.z},
        {x: center.x - half.x - p, y: center.y - half.y - p, z: center.z - half.z - p}, {x: center.x + half.x + p, y: center.y + half.y + p, z: center.z + half.z + p});
      if (!r || r.t > maxT) return null;
      return {t: r.t, n: new THREE.Vector3(...r.n).transformDirection(m)};
    };
    const near = (x: number, y: number, z: number, rad: number) => {
      const rx = x - o.x, ry = y - o.y, rz = z - o.z;
      const t = rx * d.x + ry * d.y + rz * d.z;
      if (t < -rad || t > maxT + rad) return false;
      const qx = rx - d.x * t, qy = ry - d.y * t, qz = rz - d.z * t;
      return qx * qx + qy * qy + qz * qz < rad * rad;
    };
    const m = new THREE.Matrix4();
    for (const p of pickups) {
      if (!near(p.obj.position.x, p.obj.position.y, p.obj.position.z, 0.7)) continue;
      const e = this.entForPickup(p);
      const h = test(this.objMatrix(e, m), e.center, e.half, pad);
      if (h) out.push({t: h.t, point: O.clone().addScaledVector(D, h.t), normal: h.n, pickup: p, ent: e});
    }
    for (const e of this.ents.values()) {
      if (!e.prop || !e.body) continue;
      const bp = e.body.position;
      if (!near(bp.x, bp.y, bp.z, Math.max(e.half.x, e.half.y, e.half.z) * 1.8)) continue;
      const h = test(this.objMatrix(e, m), e.center, e.half, 0);
      if (h) out.push({t: h.t, point: O.clone().addScaledVector(D, h.t), normal: h.n, prop: e.prop, propIndex: e.propIndex, ent: e});
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // ---------------------------------------------------------------------------------------
  private syncEnt(e: Ent, interp: boolean): void {
    const b = e.body;
    if (!b) return;
    const p = interp ? b.interpolatedPosition : b.position, q = interp ? b.interpolatedQuaternion : b.quaternion;
    tq.set(q.x, q.y, q.z, q.w);
    if (e.pickup) {
      const obj = e.pickup.obj;
      obj.quaternion.copy(tq);
      obj.position.set(p.x, p.y, p.z).sub(tv.copy(e.center).applyQuaternion(tq));
      obj.updateMatrix();
      // targeting / pickup anchor follows the body (PickupManager aims at y + 0.08)
      e.pickup.x = p.x;
      e.pickup.z = p.z;
      e.pickup.y = p.y - 0.08;
    } else if (e.parts && e.prop) {
      const bm = tm.compose(tv.set(p.x, p.y, p.z), tq, ts.set(1, 1, 1));
      for (const part of e.parts) { part.mesh.matrix.multiplyMatrices(bm, part.rel); part.mesh.matrixWorldNeedsUpdate = true; }
      e.prop.x = p.x;
      e.prop.z = p.z;
    }
  }

  /** Taken by the player (or cleared): drop its body, forget it. */
  private forget(key: object, e: Ent): void {
    if (e.body) this.host.world?.removeBody(e.body);
    this.active.delete(e);
    this.pendingSet.delete(e);
    this.ents.delete(key);
  }

  /** Per frame after the world step: render sync, sleep / age retirement, pending re-activation, removed pickups, walker shoves. */
  update(dt: number): void {
    const w = this.host.world;
    this.clock += dt;
    // lane PHYS (task office-props-physics-scale-20261030): only the simulating entities are stepped here; taken pickups that no
    // longer simulate are swept a few per frame (round robin), so the per-frame cost does not grow with every entity ever touched
    const live = this.scratch;
    live.length = 0;
    for (const e of this.active) live.push(e);
    for (const e of live) {
      if (e.pickup && !e.pickup.obj.parent) { this.forget(e.pickup.obj, e); continue; }
      const b = e.body;
      if (!b || b.type !== CANNON.Body.DYNAMIC) { this.active.delete(e); continue; }
      e.t += dt;
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.w)) {
        // solver blew up: put it back where it was last finite (never lose loot)
        w?.removeBody(b);
        e.body = null;
        this.active.delete(e);
        continue;
      }
      if (groundClamp(b, this.host.statics)) this.counts.clamped++;
      this.syncEnt(e, true);
      // cannon's own sleep can flicker on polygonal contacts (a can on its side): also count "calm" time
      e.sleepT = restTime(b, Math.max(e.half.x, e.half.y, e.half.z), e.sleepT, dt);
      const slow = b.velocity.length() < 0.3 && b.angularVelocity.length() < 3;
      if (e.sleepT > RETIRE_SLEEP || (e.t > 12 && slow) || e.t > 20) this.retire(e);
    }
    for (let k = 0; k < SWEEP_PER_FRAME && this.ents.size; k++) {
      let n = this.sweep?.next();
      if (!n || n.done) { this.sweep = this.ents.values(); n = this.sweep.next(); }
      if (n.done) break;
      const e = n.value;
      if (e.pickup && !e.pickup.obj.parent) this.forget(e.pickup.obj, e);
    }
    // frozen-while-moving items / props resume when there is room again
    if (this.pendingSet.size) {
      for (const kind of ['item', 'prop'] as const) {
        const room = (kind === 'item' ? MAX_DYNAMIC_ITEMS : MAX_DYNAMIC_PROPS) - this.bodies(kind).length;
        if (room <= 0) continue;
        const waiting = [...this.pendingSet].filter(e => e.kind === kind && e.pending && (!e.body || e.body.type !== CANNON.Body.DYNAMIC)).sort((a, b) => a.serial - b.serial).slice(0, room);
        for (const e of waiting) {
          const saved = e.pending!;
          const b = this.activate(e);
          if (!b) continue; // lane PHYS: no render slot right now (a reclaimed prop): it keeps waiting
          b.velocity.copy(saved.v); b.angularVelocity.copy(saved.w); this.counts.reactivated++;
          e.pending = null;
          this.pendingSet.delete(e);
        }
      }
    }
    this.wakeNeighbours();
    this.shoveByWalkers(dt);
    this.reclaimAhead();
  }

  /**
   * Moving items set resting loot lots / pickups they touch moving too (bounded per frame). Lane PHYS: in office worlds a moving
   * loose prop (a shoved chair, a toppling monitor) does too, above PROP_KNOCK_SPEED.
   */
  private wakeNeighbours(): void {
    if ((!this.pickups && !this.liftLots) || !this.active.size) return;
    let budget = 4;
    const box = new THREE.Box3(), other = new THREE.Box3(), m = new THREE.Matrix4();
    const props = this.officeRules;
    const live = [...this.active]; // lane PHYS: the simulating entities only (activations below add to the set)
    for (const e of live) {
      const b = e.body;
      if (budget <= 0) break;
      if (!b || b.type !== CANNON.Body.DYNAMIC || b.velocity.length() < 0.25) continue;
      // task office-props-physics-scale-20261030 (lane PHYS): a calibrated `contact` kind knocks lots on in every world
      if (e.kind !== 'item' && !((props || e.contact) && e.kind === 'prop' && b.velocity.length() >= PROP_KNOCK_SPEED)) continue;
      const win = 0.6 + (e.kind === 'prop' ? Math.max(e.half.x, e.half.z) : 0);
      if (b.aabbNeedsUpdate) b.updateAABB();
      // predictive: the box swept ~2 fixed steps ahead, so a neighbour gets its body BEFORE the contact
      const vx = b.velocity.x * 0.034, vy = b.velocity.y * 0.034, vz = b.velocity.z * 0.034;
      box.min.set(b.aabb.lowerBound.x + Math.min(0, vx), b.aabb.lowerBound.y + Math.min(0, vy), b.aabb.lowerBound.z + Math.min(0, vz)).subScalar(0.006);
      box.max.set(b.aabb.upperBound.x + Math.max(0, vx), b.aabb.upperBound.y + Math.max(0, vy), b.aabb.upperBound.z + Math.max(0, vz)).addScalar(0.006);
      for (const pk of this.liftLots?.(box) ?? []) {
        const n = this.entForPickup(pk);
        if (this.activate(n)) { this.counts.knockOn++; budget--; }
      }
      for (const pk of this.pickups?.() ?? []) {
        if (budget <= 0) break;
        if (pk === e.pickup || Math.abs(pk.obj.position.x - b.position.x) > win || Math.abs(pk.obj.position.z - b.position.z) > win) continue;
        const n = this.entForPickup(pk);
        if (n.body && n.body.type === CANNON.Body.DYNAMIC) continue;
        obbBox(this.objMatrix(n, m), n.center, n.half, other);
        if (!other.intersectsBox(box)) continue;
        if (this.activate(n)) { this.counts.knockOn++; budget--; }
      }
    }
  }

  /**
   * Walkers push loose props (and sprinters kick loose items lying at their feet). Lane PHYS: walkers also contact-wake (task
   * office-props-physics-scale-20261030: in every world). Loose props come from the simulating set + the rest index around each
   * walker (never a scan of every loose prop per walker).
   */
  private shoveByWalkers(dt: number): void {
    const contact = this.contactOn, office = this.officeRules;
    if (!this.counts.props && !contact) return; // no loose prop yet and no contact wake (cheap idle path)
    const list = this.walkers?.();
    this.wakePts.length = 0;
    if (!list || !list.length || dt <= 0) return;
    const wakers = list.filter(w => w.wake);
    for (const w of wakers) this.wakePts.push(w.x, w.y, w.z);
    for (const a of list) {
      const last = this.lastPos.get(a.id);
      this.lastPos.set(a.id, {x: a.x, z: a.z});
      if (!last) continue;
      const vx = (a.x - last.x) / dt, vz = (a.z - last.z) / dt, sp = Math.hypot(vx, vz);
      if (sp < 0.3 || sp > 12) continue;
      // lane PHYS: walking into a light prop wakes it (the player; AI only near the player)
      if (contact && (a.wake || wakers.some(w => Math.abs(w.y - a.y) < 3 && Math.hypot(w.x - a.x, w.z - a.z) < CONTACT_RANGE))) this.contactScan(a, vx / sp, vz / sp);
      if (!this.counts.props) continue;
      for (const e of this.looseNear(a.x, a.z, a.r + 0.03, this.nearBuf)) {
        if (!e.prop || !e.body) continue;
        const b = e.body;
        if (Math.abs(b.position.y - a.y) > 1.2) continue;
        // footprint: the body's world AABB
        if (b.aabbNeedsUpdate) b.updateAABB();
        const lb = b.aabb.lowerBound, ub = b.aabb.upperBound;
        if (lb.y > a.y + 1.6 || ub.y < a.y + 0.05) continue;
        // lane PHYS: office rules — every world for a calibrated `contact` kind (task office-props-physics-scale-20261030)
        const cal = office || !!e.contact;
        if (cal && lb.y > a.y + RAISED_SHOVE) continue; // lane PHYS: a monitor on a desk is out of reach of the legs
        const nx = Math.max(lb.x, Math.min(a.x, ub.x)), nz = Math.max(lb.z, Math.min(a.z, ub.z));
        const dx = nx - a.x, dz = nz - a.z, dist = Math.hypot(dx, dz);
        if (dist > a.r + 0.03) continue;
        const ux = vx / sp, uz = vz / sp;
        // only when moving into it
        const toward = dist > 1e-4 ? (dx * ux + dz * uz) / dist : 1;
        if (toward < 0.2) continue;
        const body = this.activate(e);
        if (!body) continue;
        const along = body.velocity.x * ux + body.velocity.z * uz;
        const need = sp * 1.1 - along;
        if (need <= 0) continue;
        // lane PHYS: office rules close the speed gap faster (calibrated carpet friction: the walker would reach into a 20 kg piece)
        const j = Math.min(need, 2.5) * e.mass * (cal ? OFFICE_SHOVE_GAIN : 0.35);
        cv.set(ux * j, 0, uz * j);
        // lane PHYS: office rules push within the body's own height (a 39 cm bean bag is not flipped by a push above its top)
        cv2.set(nx - body.position.x, Math.min(0.25, a.y + 0.6 - body.position.y, cal ? e.half.y * 0.5 : Infinity), nz - body.position.z);
        body.applyImpulse(cv, cv2);
        this.counts.pushes++;
      }
    }
  }

  /**
   * Lane PHYS: wake the light floor props `a` is walking into (task office-props-physics-scale-20261030: every world). Candidates
   * come from a per-world bucket index of the dynamic, non-holder `contact` kinds; a prop wakes when the walker is within
   * CONTACT_MARGIN of its box, heading for it, at its height, and the damage system still has CONTACT_RESERVE detach slots (resting
   * props' renders are reclaimed first when it has not). The woken prop loses its AABB (the walker no longer stops at it) and the
   * loose-prop shove above moves it from this frame on.
   */
  private contactScan(a: Walker, ux: number, uz: number): void {
    const s = this.host.statics;
    if (!s) return;
    if (this.contactIndex?.statics !== s) this.contactIndex = {statics: s, cells: contactCells(s.props)};
    const cells = this.contactIndex.cells, props = s.props, reach = a.r + CONTACT_MARGIN, seen = this.scanSeen;
    seen.clear();
    for (let cz = Math.floor((a.z - reach) / CB); cz <= Math.floor((a.z + reach) / CB); cz++) {
      for (let cx = Math.floor((a.x - reach) / CB); cx <= Math.floor((a.x + reach) / CB); cx++) {
        for (const i of cells.get(cellKey(cx, cz)) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const p = props[i];
          if (p.h <= 0.02 || this.ents.has(p)) continue;
          // a floor prop at the walker's feet (never one on a desk / counter: its host is in the way)
          if (p.y > a.y + 0.45 || p.y < a.y - 0.6 || p.y + p.h < a.y + 0.05) continue;
          const nx = Math.max(p.x - p.hx, Math.min(a.x, p.x + p.hx)), nz = Math.max(p.z - p.hz, Math.min(a.z, p.z + p.hz));
          const dx = nx - a.x, dz = nz - a.z, dist = Math.hypot(dx, dz);
          if (dist > reach) continue;
          if ((dist > 1e-4 ? (dx * ux + dz * uz) / dist : 1) < 0.2) continue; // only when moving into it
          if (!this.contactRoom()) return;
          if (!this.isDynamicProp(p)) continue;
          if (this.entForProp(p, i)) this.counts.contacts++;
        }
      }
    }
  }

  /**
   * Lane PHYS (task office-props-physics-scale-20261030): whether a contact wake may detach one more prop — more than
   * CONTACT_RESERVE soft slots left (bullet marks keep their headroom), after reclaiming resting props' renders if not.
   */
  private contactRoom(): boolean {
    const d = this.detacher;
    if (!d?.detachRoom) return true;
    let room = d.detachRoom();
    // reclaim right now (bounded): a walker stopped at the prop's box no longer moves, so a later frame would not wake it
    for (let k = 0; room <= CONTACT_RESERVE && k < 3; k++) {
      if (!this.reclaim(CONTACT_RESERVE + 1 - room)) break;
      room = d.detachRoom();
    }
    return room > CONTACT_RESERVE;
  }

  /** Lane PHYS: loose props whose body centre lies in `area` (x / z): the simulating set + the rest index over it (or every one). */
  private looseIn(area: {x0: number; z0: number; x1: number; z1: number} | undefined, out: Ent[]): Ent[] {
    out.length = 0;
    if (!area) { for (const e of this.ents.values()) if (e.prop && e.body) out.push(e); return out; }
    for (const e of this.active) if (e.prop) out.push(e);
    const S = STATIC_CHUNK_M, pad = 0.01;
    for (let cz = Math.floor((area.z0 - pad) / S); cz <= Math.floor((area.z1 + pad) / S); cz++) {
      for (let cx = Math.floor((area.x0 - pad) / S); cx <= Math.floor((area.x1 + pad) / S); cx++) {
        const set = this.rest.get((cz + 4096) * 8192 + (cx + 4096));
        if (set) for (const e of set) out.push(e);
      }
    }
    return out;
  }

  /**
   * Lane LIFT riders (lane PHYS): resting loose props (STATIC bodies, also budget-frozen ones) inside the moving cab ride its dy
   * (simulating bodies are carried by PhysicsSystem.carryRiders); every loose prop inside keeps its placement height in step.
   * Call BEFORE the simulating bodies are shifted (the test uses the pre-move positions). Returns the props carried. Task
   * office-props-physics-scale-20261030: `area` (the cab's x / z box) bounds the search to the rest index there.
   */
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number, area?: {x0: number; z0: number; x1: number; z1: number}): number {
    let n = 0;
    for (const e of this.looseIn(area, this.nearBuf)) {
      const b = e.body;
      if (!e.prop || !b) continue;
      const p = b.position;
      if (!inside(p.x, p.y, p.z)) continue;
      e.prop.y += dy;
      if (b.type !== CANNON.Body.DYNAMIC) {
        if (!e.parts) this.redetach(e); // lane PHYS: reclaimed (never beside a shaft — defensive): drawn by its own meshes to ride
        p.y += dy; b.previousPosition.y += dy; b.interpolatedPosition.y += dy;
        b.aabbNeedsUpdate = true;
        this.syncEnt(e, false);
      }
      n++;
    }
    this.counts.carried += n;
    return n;
  }

  /** Lane LIFT (lane PHYS): resting loose props in a doorway the landing doors shut on go to the nearer side (`area`: the doorway). */
  relocate(move: (x: number, y: number, z: number) => [number, number] | null, area?: {x0: number; z0: number; x1: number; z1: number}): number {
    let n = 0;
    for (const e of this.looseIn(area, this.nearBuf)) {
      const b = e.body;
      if (!e.prop || !b || b.type === CANNON.Body.DYNAMIC) continue;
      const p = b.position, to = move(p.x, p.y, p.z);
      if (!to) continue;
      if (!e.parts) this.redetach(e); // lane PHYS: defensive, as in carry()
      const dx = to[0] - p.x, dz = to[1] - p.z;
      p.x += dx; p.z += dz; b.previousPosition.x += dx; b.previousPosition.z += dz; b.interpolatedPosition.x += dx; b.interpolatedPosition.z += dz;
      b.aabbNeedsUpdate = true;
      this.syncEnt(e, false);
      this.toRest(e); // lane PHYS: its chunk may have changed
      n++;
    }
    return n;
  }

  /** Remove every body (New Station). Pickup objects / prop placements belong to their owners. */
  clear(): void {
    for (const e of this.ents.values()) if (e.body) this.host.world?.removeBody(e.body);
    this.ents.clear();
    for (const b of this.hostSlabs.values()) this.host.world?.removeBody(b); // lane PHYS
    this.hostSlabs.clear();
    this.contactIndex = null;
    // task office-props-physics-scale-20261030 (lane PHYS)
    this.active.clear(); this.rest.clear(); this.reclaimQ.clear(); this.pendingSet.clear();
    this.maxRad = 0; this.sweep = null; this.wakePts.length = 0;
  }

  /**
   * QA / tests. Task office-props-physics-scale-20261030 (lane PHYS): + resting (loose props with a static body), restingInWorld
   * (of those, in the cannon world now: their chunk is active), ownRender (resting ones still drawn by their own meshes).
   */
  stats(): {items: number; itemsAwake: number; props: number; propsAwake: number; pending: number; resting: number; restingInWorld: number; ownRender: number; counts: Record<string, number>} {
    let items = 0, props = 0, pending = 0, resting = 0, inWorld = 0, own = 0;
    for (const e of this.ents.values()) { if (e.kind === 'item') items++; else props++; if (e.pending) pending++; }
    for (const set of this.rest.values()) for (const e of set) { resting++; if (e.body?.world) inWorld++; if (e.parts) own++; }
    return {items, itemsAwake: this.bodies('item').length, props, propsAwake: this.bodies('prop').length, pending, resting, restingInWorld: inWorld, ownRender: own, counts: {...this.counts}};
  }

  /** QA: tracked entities (bounded). */
  list(max = 24): {kind: string; itemId?: string; propKind?: string; x: number; y: number; z: number; awake: boolean; pending: boolean; shots: number}[] {
    const out: ReturnType<DynamicItems['list']> = [];
    for (const e of this.ents.values()) {
      if (out.length >= max) break;
      const b = e.body;
      const at = b ? b.position : e.pickup ? e.pickup.obj.position : {x: e.prop!.x, y: e.prop!.y, z: e.prop!.z};
      out.push({kind: e.kind, itemId: e.pickup?.stack.itemId, propKind: e.prop?.kind, x: at.x, y: at.y, z: at.z, awake: !!b && b.type === CANNON.Body.DYNAMIC, pending: !!e.pending, shots: e.shots});
    }
    return out;
  }
}

const tv2 = new THREE.Vector3();

/** Lane PHYS: bucket key of a CB-metre cell. */
const cellKey = (cx: number, cz: number) => (cz + 4096) * 8192 + (cx + 4096);

/** Lane PHYS: contact-wake candidates — indices of the dynamic, non-holder `contact` props with a box, per CB-metre bucket they overlap. */
function contactCells(props: readonly PropPlacement[]): Map<number, number[]> {
  const cells = new Map<number, number[]>();
  const kinds = new Map<string, boolean>();
  props.forEach((p, i) => {
    let ok = kinds.get(p.kind);
    if (ok === undefined) kinds.set(p.kind, (ok = !!propPhysics(p.kind).contact && dynamicKind(p.kind) && !isLootHolderKind(p.kind)));
    if (!ok || p.h <= 0.02 || p.mounted) return;
    for (let cz = Math.floor((p.z - p.hz) / CB); cz <= Math.floor((p.z + p.hz) / CB); cz++) {
      for (let cx = Math.floor((p.x - p.hx) / CB); cx <= Math.floor((p.x + p.hx) / CB); cx++) {
        const k = cellKey(cx, cz);
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(i);
      }
    }
  });
  return cells;
}
