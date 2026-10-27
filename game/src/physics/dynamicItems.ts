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

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {rayAabb, type Vec3} from '../combat/hitscan';
import {itemPhysics, propPhysics, type PhysMat} from '../damage/materials';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {isLootHolderKind} from '../items/loot';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_RAGDOLL, GROUP_STATIC} from './ragdoll';
import {groundClamp, restTime, type BodyHost, type ImpactFamily} from './chunks';

export const MAX_DYNAMIC_ITEMS = 16;
export const MAX_DYNAMIC_PROPS = 4;
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

/** A walker that shoves loose props (player, zombies); id = any stable object. */
export interface Walker { id: object; x: number; z: number; y: number; r: number }

/** What dynamic props need from the prop damage system (damage/propDamage.ts). */
export interface PropDetacher {
  /** Detach the prop's render instances into its own meshes (marks them moving); null if impossible. */
  detachForPhysics(prop: PropPlacement, index: number): THREE.Mesh[] | null;
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
  parts?: {mesh: THREE.Mesh; rel: THREE.Matrix4}[];
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

const FAM: Record<PhysMat, ImpactFamily> = {metal: 'can', plastic: 'light', soft: 'light', heavy: 'heavy', stone: 'stone', wood: 'wood', glass: 'glass', flesh: 'flesh', cloth: 'flesh'};

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
  private readonly lastPos = new WeakMap<object, {x: number; z: number}>();
  /** Counters (QA/tests). */
  readonly counts = {activated: 0, shots: 0, retired: 0, frozen: 0, reactivated: 0, pushes: 0, impacts: 0, props: 0, knockOn: 0, clamped: 0};

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
      if (e.soundT > 0) return;
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (v < 0.75) return;
      e.soundT = 0.14;
      this.counts.impacts++;
      this.host.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, e.kind === 'prop' ? 'prop' : e.fam);
    });
    return body;
  }

  private bodies(kind: 'item' | 'prop'): Ent[] {
    const out: Ent[] = [];
    for (const e of this.ents.values()) if (e.kind === kind && e.body && e.body.type === CANNON.Body.DYNAMIC) out.push(e);
    return out;
  }

  get awake(): number {
    let n = 0;
    for (const e of this.ents.values()) if (e.body && e.body.type === CANNON.Body.DYNAMIC) n++;
    return n;
  }

  /** Positions of simulating bodies (static collision chunks are kept around them). */
  activePoints(out: CANNON.Vec3[]): void {
    for (const e of this.ents.values()) if (e.body && e.body.type === CANNON.Body.DYNAMIC) out.push(e.body.position);
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
    this.makeRoom(e.kind);
    if (e.body) {
      // a resting loose prop (static body): back to dynamic
      e.body.type = CANNON.Body.DYNAMIC;
      e.body.mass = e.mass;
      e.body.updateMassProperties();
      e.body.wakeUp();
    } else {
      e.body = this.makeBody(e, this.objMatrix(e, new THREE.Matrix4()));
      w.addBody(e.body);
    }
    e.serial = ++this.serial;
    e.t = 0;
    e.sleepT = 0;
    this.counts.activated++;
    this.host.bodiesChanged();
    return e.body;
  }

  /** Stop simulating: items drop their body (rest where they are), props become static bodies (frozen: pose kept, velocity saved in `pending`). */
  private retire(e: Ent, frozen = false): void {
    const b = e.body;
    if (!b) return;
    this.syncEnt(e, false);
    // props keep their body as a STATIC obstacle at the current pose (also while frozen by the budget)
    if (e.kind === 'prop') {
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.type = CANNON.Body.STATIC;
      b.mass = 0;
      b.updateMassProperties();
      b.aabbNeedsUpdate = true;
    } else {
      this.host.world?.removeBody(b);
      e.body = null;
    }
    if (!frozen) e.pending = null;
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
    const ph = propPhysics(prop.kind);
    if (!ph.dynamic || !Number.isFinite(ph.mass) || isLootHolderKind(prop.kind)) return false;
    if (this.ents.has(prop)) return true;
    const g = this.host.statics?.cellGround(prop.x, prop.z);
    return g === undefined || (Number.isFinite(g) && Math.abs(prop.y - g) < 0.06);
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
    const meshes = this.detacher?.detachForPhysics(prop, index) ?? null;
    if (!meshes || !meshes.length) return null;
    const def = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number} | undefined>)[prop.kind];
    const quarter = Math.round(prop.rot / (Math.PI / 2)) & 1;
    const w = def?.w ?? (quarter ? prop.hz * 2 : prop.hx * 2), d = def?.d ?? (quarter ? prop.hx * 2 : prop.hz * 2), h = prop.h;
    const shape = ph.shape ?? 'box';
    const half = shape === 'cylinder' ? new THREE.Vector3(Math.min(w, d) / 2, h / 2, Math.min(w, d) / 2) : new THREE.Vector3(w / 2, h / 2, d / 2);
    e = {kind: 'prop', serial: 0, body: null, pending: null, center: new THREE.Vector3(0, h / 2, 0), half, shape, mass: ph.mass, mat: ph.mat ?? 'metal', fam: 'prop',
      t: 0, sleepT: 0, soundT: 0, shots: 0, prop, propIndex: index};
    const body = this.host.world ? this.makeBody(e, this.objMatrix(e, new THREE.Matrix4())) : null;
    if (!body) return null;
    const bm = new THREE.Matrix4().compose(tv.set(body.position.x, body.position.y, body.position.z), tq.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w), ts.set(1, 1, 1));
    const inv = bm.clone().invert();
    e.parts = meshes.map(mesh => ({mesh, rel: inv.clone().multiply(mesh.matrix)}));
    // loose from now on: no longer an AABB obstacle for walking / hitscan / statics (hit-tested here)
    prop.h = 0;
    prop.blocksSight = false;
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
    this.host.world!.addBody(body);
    e.body = body;
    this.ents.set(prop, e);
    this.counts.props++;
    this.host.propsChanged?.(prop.x, prop.z);
    return e;
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

  /** Per frame after the world step: render sync, sleep / age retirement, pending re-activation, removed pickups, walker shoves. */
  update(dt: number): void {
    const w = this.host.world;
    for (const [key, e] of this.ents) {
      if (e.pickup && !e.pickup.obj.parent) {
        // taken by the player (or cleared): drop its body, forget it
        if (e.body) w?.removeBody(e.body);
        this.ents.delete(key);
        continue;
      }
      e.soundT = Math.max(0, e.soundT - dt);
      const b = e.body;
      if (!b || b.type !== CANNON.Body.DYNAMIC) continue;
      e.t += dt;
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.w)) {
        // solver blew up: put it back where it was last finite (never lose loot)
        w?.removeBody(b);
        e.body = null;
        continue;
      }
      if (groundClamp(b, this.host.statics)) this.counts.clamped++;
      this.syncEnt(e, true);
      // cannon's own sleep can flicker on polygonal contacts (a can on its side): also count "calm" time
      e.sleepT = restTime(b, Math.max(e.half.x, e.half.y, e.half.z), e.sleepT, dt);
      const slow = b.velocity.length() < 0.3 && b.angularVelocity.length() < 3;
      if (e.sleepT > RETIRE_SLEEP || (e.t > 12 && slow) || e.t > 20) this.retire(e);
    }
    // frozen-while-moving items / props resume when there is room again
    for (const kind of ['item', 'prop'] as const) {
      const room = (kind === 'item' ? MAX_DYNAMIC_ITEMS : MAX_DYNAMIC_PROPS) - this.bodies(kind).length;
      if (room <= 0) continue;
      const waiting = [...this.ents.values()].filter(e => e.kind === kind && e.pending && (!e.body || e.body.type !== CANNON.Body.DYNAMIC)).sort((a, b) => a.serial - b.serial).slice(0, room);
      for (const e of waiting) {
        const saved = e.pending!;
        const b = this.activate(e);
        if (b) { b.velocity.copy(saved.v); b.angularVelocity.copy(saved.w); this.counts.reactivated++; }
        e.pending = null;
      }
    }
    this.wakeNeighbours();
    this.shoveByWalkers(dt);
  }

  /** Moving items set resting loot lots / pickups they touch moving too (bounded per frame). */
  private wakeNeighbours(): void {
    if (!this.pickups && !this.liftLots) return;
    let budget = 4;
    const box = new THREE.Box3(), other = new THREE.Box3(), m = new THREE.Matrix4();
    for (const e of [...this.ents.values()]) {
      const b = e.body;
      if (budget <= 0) break;
      if (!b || b.type !== CANNON.Body.DYNAMIC || e.kind !== 'item' || b.velocity.length() < 0.25) continue;
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
        if (pk === e.pickup || Math.abs(pk.obj.position.x - b.position.x) > 0.6 || Math.abs(pk.obj.position.z - b.position.z) > 0.6) continue;
        const n = this.entForPickup(pk);
        if (n.body && n.body.type === CANNON.Body.DYNAMIC) continue;
        obbBox(this.objMatrix(n, m), n.center, n.half, other);
        if (!other.intersectsBox(box)) continue;
        if (this.activate(n)) { this.counts.knockOn++; budget--; }
      }
    }
  }

  /** Walkers push loose props (and sprinters kick loose items lying at their feet). */
  private shoveByWalkers(dt: number): void {
    if (!this.counts.props) return; // no loose prop yet (cheap idle path)
    const list = this.walkers?.();
    if (!list || !list.length || dt <= 0) return;
    for (const a of list) {
      const last = this.lastPos.get(a.id);
      this.lastPos.set(a.id, {x: a.x, z: a.z});
      if (!last) continue;
      const vx = (a.x - last.x) / dt, vz = (a.z - last.z) / dt, sp = Math.hypot(vx, vz);
      if (sp < 0.3 || sp > 12) continue;
      for (const e of this.ents.values()) {
        if (!e.prop || !e.body) continue;
        const b = e.body;
        if (Math.abs(b.position.y - a.y) > 1.2) continue;
        // footprint: the body's world AABB
        if (b.aabbNeedsUpdate) b.updateAABB();
        const lb = b.aabb.lowerBound, ub = b.aabb.upperBound;
        if (lb.y > a.y + 1.6 || ub.y < a.y + 0.05) continue;
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
        const j = Math.min(need, 2.5) * e.mass * 0.35;
        cv.set(ux * j, 0, uz * j);
        cv2.set(nx - body.position.x, Math.min(0.25, a.y + 0.6 - body.position.y), nz - body.position.z);
        body.applyImpulse(cv, cv2);
        this.counts.pushes++;
      }
    }
  }

  /** Remove every body (New Station). Pickup objects / prop placements belong to their owners. */
  clear(): void {
    for (const e of this.ents.values()) if (e.body) this.host.world?.removeBody(e.body);
    this.ents.clear();
  }

  stats(): {items: number; itemsAwake: number; props: number; propsAwake: number; pending: number; counts: Record<string, number>} {
    let items = 0, props = 0, pending = 0;
    for (const e of this.ents.values()) { if (e.kind === 'item') items++; else props++; if (e.pending) pending++; }
    return {items, itemsAwake: this.bodies('item').length, props, propsAwake: this.bodies('prop').length, pending, counts: {...this.counts}};
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
