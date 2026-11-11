// Task studio-woodchipper-ragdoll-20261111-033048-01 (user: "a corpse enters real ragdoll physics while being sucked through the hopper.
// The body should go limp, with limbs flopping and reacting naturally as the machine draws it in, rather than remaining in a posed feeding
// animation. Keep the result controlled so bodies feed through without becoming permanently stuck, flying out or breaking the machine"):
// the fed body's FEED PHYSICS (world/chipper.ts steps it while the machine grinds).
//
// THE BODY: its own articulated ragdoll (physics/ragdoll.ts Ragdoll on its actor: the same parts, joints and limits as any corpse; no new
// asset) in a PRIVATE, bounded cannon world in the chipper group's train-local frame — it rides with the car, and nothing in it touches
// the game's physics world, the player, the machine's collider or another body. THE MACHINE in that world: static boxes round the
// hopper's open mouth (its end wall, the rotor housing block beyond it, the low side lips + flap curtain as solid sides, the hopper
// floor; world/chipperSpec.ts anchors) and the car floor.
// THE DRAW: the crown goes down a feed line (the posed visual's final line, chipperView.ts feedLine: down into the casing toward the
// rotor housing) to the depth the job's progress gives (chipperView.ts feedDepth: the same lunge staircase the blood's lunge bursts
// follow), and each part, in its turn along the body (crown first, soles last), is TAKEN — kinematic, no contacts — and follows its
// point on that line (the straight lying body's own layout, its shoulders along the mouth's long side) within CHIPPER_FEED.tau, with
// the machine's tremor. The parts still outside are FREE: limp, flopping under gravity over the rim and down the machine's front,
// dragged through their joints by the parts already in (every lunge jerks them), and pulled toward the mouth once theirs is next.
// CONTROL (never stuck, never flying out, never breaking anything): a part is taken once it is inside the mouth, or anyway
// CHIPPER_FEED.deadline m past its turn (a brief clip through a rim beats a jam), and every part from CHIPPER_FEED.allBy of the progress
// on; the RECORD alone credits the job (20 s, the fuel, once: world/chipper.ts disposes the visual in that frame whatever its physics
// did); the free parts' speeds are capped and they stay inside the car interior; a free part that starts inside the machine's boxes
// keeps only the floor until it is clear; a fixed sub-step, at most CHIPPER_FEED.maxSub per frame (a long frame drops the rest: no
// catch-up burst); a non-finite or runaway body FAILS the feed — the runtime restores the bones (restore()) and falls back to the posed
// feed (chipperView.ts FedBody.place). It steps only while the machine grinds: riding / paused, the body hangs as it is.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GROUP_RAGDOLL, GROUP_STATIC, Ragdoll, RAGDOLL_TUNING, type RagdollTarget} from '../physics/ragdoll';
import {CHIPPER_ANCHORS, CHIPPER_SIZE} from './chipperSpec';
import {chipperToLocal, type ChipperPlacement} from './chipperPlace';
import {CHIPPER_VIEW, feedDepth, feedLine, type FedBody} from './chipperView';

/** Tuning (one place). */
export const CHIPPER_FEED = {
  /** Fixed sub-step (s), the most sub-steps one frame takes, the solver's iterations. */
  step: 1 / 60, maxSub: 4, iterations: 12,
  /** The grip: a taken part follows its point on the feed line within `tau` (s), at most `vMax` (m/s) / `wMax` (rad/s). */
  tau: 0.12, vMax: 1.6, wMax: 9,
  /**
   * The bend over the lip: a taken part just past the mouth turns toward the body still hanging outside (the free parts' centre of mass
   * as seen from the mouth, smoothed over `outLag` s) and straightens onto the line over its first `bend` m inside — so the parts outside
   * drape from it instead of being held up by a neck / spine limit against a part already pointing down the line.
   */
  bend: 0.6, outLag: 0.25,
  /**
   * A part's turn: its centre's place along the body (m from the crown) within `lead` of the feed depth. Then it is taken as soon as its
   * centre is inside the mouth (within `margin` m of the mouth's rectangle, below the rim + `over` m), or anyway `deadline` m past its
   * turn; from `allBy` of the job's progress on every part is taken.
   */
  lead: 0.04, margin: 0.02, over: 0.12, deadline: 0.3, allBy: 0.9,
  /**
   * The suction on the next parts (their turn within `reach` m): an acceleration (m/s²) toward a point `aim` m above the mouth (a little
   * below it: a pull aimed over the rim props the torso up instead of letting it drape).
   */
  suck: 4, reach: 0.35, aim: -0.05,
  /** The free parts' speed caps (m/s, rad/s). */
  vFree: 3.2, wFree: 16,
  /** Friction of the body on the machine / on the car floor (no bounce). */
  friction: {machine: 0.15, floor: 0.5},
  /** The hopper's floor (m above the machine's base: world/chipperSpec.ts hopper shape, ~0.47) — a free limb rests in it. */
  hopperFloor: 0.47,
  /** The free parts stay this far inside the car interior's walls / ceiling (m). */
  wallPad: 0.06,
  /** A part farther than this from the mouth on any axis (m) is a runaway: the feed fails (the posed fallback). */
  away: 4,
  /** The body's cull sphere round its pelvis (x its scale, m). */
  cull: 1.9,
} as const;

/** The private world's collision groups: the machine's boxes (GROUP_STATIC), the car floor, the body's parts (GROUP_RAGDOLL). */
const GROUP_FLOOR = 16;
const FREE_MASK = GROUP_STATIC | GROUP_FLOOR;

/** One static box of the feed world (model frame, m: world/chipperSpec.ts — base centre origin, +Z the front, -X the hopper end). */
export interface FeedBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; floor: boolean }

/** The machine round the hopper's mouth and the car floor, as the feed world's boxes (the mouth's column above the hopper floor is open). */
export function chipperFeedBoxes(): FeedBox[] {
  const A = CHIPPER_ANCHORS, S = CHIPPER_SIZE, F = CHIPPER_FEED;
  const hx = S.l / 2, hz = S.d / 2, top = A.hopper.y;
  const mx0 = A.hopper.x - A.hopperMouth.x / 2, mx1 = A.hopper.x + A.hopperMouth.x / 2;
  const mz0 = A.hopper.z - A.hopperMouth.z / 2, mz1 = A.hopper.z + A.hopperMouth.z / 2;
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, floor = false): FeedBox => ({x0, y0, z0, x1, y1, z1, floor});
  return [
    box(-hx, 0, -hz, mx0, top, hz), // the hopper's end wall (model -X)
    box(mx1, 0, -hz, hx, top, hz), // beyond the hopper: the rotor housing, the control box, the tanks
    box(mx0, 0, mz1, mx1, top, hz), // the front lip + the flap curtain under the front rail (the aisle side)
    box(mx0, 0, -hz, mx1, top, mz0), // the back lip
    box(mx0, F.hopperFloor - 0.06, mz0, mx1, F.hopperFloor, mz1), // the hopper's floor (a taken part passes it: no contacts)
    box(-3, -0.3, -3, 3, 0, 3, true), // the car floor round the machine
  ];
}

/** A train-local point -> the machine's model frame (x / z; the inverse of chipperPlace.ts chipperToLocal). */
function toModel(c: ChipperPlacement, x: number, z: number, out: {x: number; z: number}): {x: number; z: number} {
  const cy = c.yaw === Math.PI ? -1 : Math.cos(c.yaw), sy = c.yaw === Math.PI ? 0 : Math.sin(c.yaw);
  const dx = x - c.x, dz = z - c.z;
  out.x = dx * cy - dz * sy;
  out.z = dx * sy + dz * cy;
  return out;
}

type RagdollPart = Ragdoll['parts'][number];

interface FeedPart {
  readonly part: RagdollPart;
  readonly body: CANNON.Body;
  /** Its centre's place along the body: m from the crown toward the soles (the straight lying body's own line). */
  readonly chain: number;
  /** On the feed line: its centre's offset from the crown's point and its orientation (train-local). */
  readonly off: THREE.Vector3;
  readonly q: THREE.Quaternion;
  /** Taken by the machine (kinematic, no contacts), and whether it was taken by the deadline (not inside the mouth). */
  taken: boolean;
  forced: boolean;
  /** Started inside the machine's boxes: only the floor until clear. */
  ghost: boolean;
}

export interface ChipperFeedOptions {
  /** The fed body (its object a child of the chipper's group, posed at the job's progress by FedBody.place) and its actor. */
  fed: FedBody;
  target: RagdollTarget;
  place: ChipperPlacement;
  /** Train-local: the hopper mouth's centre at the rim; the aisle, the mouth's long side and the hopper's end (unit horizontals). */
  hopper: {x: number; y: number; z: number};
  aisle: {x: number; z: number};
  long: {x: number; z: number};
  end: {x: number; z: number};
  /** The car interior (train-local): the free parts stay inside it. */
  bounds: {x0: number; x1: number; halfWidth: number; floorY: number; ceilY: number};
  /** The job's progress the body starts at (0: a fresh feed; a load mid-grind: later). */
  p: number;
}

/** Every bone's local pose (the posed fallback's restore point). */
type BoneSnapshot = {bone: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion}[];

function snapshot(obj: THREE.Object3D): BoneSnapshot {
  const out: BoneSnapshot = [];
  obj.traverse(o => { if ((o as THREE.Bone).isBone) out.push({bone: o, p: o.position.clone(), q: o.quaternion.clone()}); });
  return out;
}

function restoreBones(s: BoneSnapshot): void {
  for (const b of s) { b.bone.position.copy(b.p); b.bone.quaternion.copy(b.q); }
}

/** Run f with `obj` out of its parent: its world matrices are its parent's frame (the ragdoll reads world matrices). Re-parented after. */
function inParentFrame<T>(obj: THREE.Object3D, f: () => T): T {
  const parent = obj.parent;
  parent?.remove(obj);
  try {
    obj.updateMatrixWorld(true);
    return f();
  } finally {
    if (parent) { parent.add(obj); obj.updateMatrixWorld(true); }
  }
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion();
const tm = {x: 0, z: 0};
const cv = new CANNON.Vec3();

export class ChipperFeed {
  readonly world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0)});
  readonly ragdoll: Ragdoll;
  readonly parts: FeedPart[] = [];
  /** The feed line's out direction (from inside the machine up through the mouth toward the soles; train-local, unit). */
  readonly line = new THREE.Vector3();
  /** The crown's depth past the mouth along the line now (m). */
  depth: number;
  /** A non-finite / runaway body (the runtime restores the bones and poses the body instead). */
  failed = false;
  /** QA / tests. */
  readonly stats = {steps: 0, taken: 0, forced: 0, ghosts: 0, contained: 0, capped: 0, peakFree: 0};
  readonly boxes = chipperFeedBoxes();
  private readonly obj: THREE.Object3D;
  private readonly len: number;
  private readonly cullAt = new THREE.Vector3();
  /** From the mouth toward the body still outside (unit, smoothed; the line until a free part was seen). */
  private readonly out = new THREE.Vector3();
  private outSeen = false;

  /** The feed for a body (null: its actor has no ragdoll for it — the bones are left exactly as they were). */
  static create(o: ChipperFeedOptions): ChipperFeed | null {
    const snap = snapshot(o.fed.obj);
    try {
      return new ChipperFeed(o, snap);
    } catch (err) {
      console.warn('chipper: no feed physics for this body (posed feed)', err);
      restoreBones(snap);
      return null;
    }
  }

  private constructor(readonly o: ChipperFeedOptions, private readonly snap: BoneSnapshot) {
    const F = CHIPPER_FEED, obj = (this.obj = o.fed.obj), f = o.fed.frame;
    if (o.target.root !== obj) throw new Error('chipper feed: the ragdoll target is not the fed body');
    this.len = f.len;
    const w = this.world;
    w.allowSleep = false;
    (w.solver as CANNON.GSSolver).iterations = F.iterations;
    const flesh = new CANNON.Material('chipper-feed-body'), steel = new CANNON.Material('chipper-feed-machine'), deck = new CANNON.Material('chipper-feed-floor');
    w.addContactMaterial(new CANNON.ContactMaterial(flesh, steel, {friction: F.friction.machine, restitution: 0}));
    w.addContactMaterial(new CANNON.ContactMaterial(flesh, deck, {friction: F.friction.floor, restitution: 0}));
    const c = o.place, yaw = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.yaw);
    for (const b of this.boxes) {
      const at = chipperToLocal(c, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      const body = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC, material: b.floor ? deck : steel,
        collisionFilterGroup: b.floor ? GROUP_FLOOR : GROUP_STATIC, collisionFilterMask: GROUP_RAGDOLL});
      body.addShape(new CANNON.Box(new CANNON.Vec3((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2)));
      body.position.set(at.x, at.y, at.z);
      body.quaternion.copy(yaw);
      w.addBody(body);
    }
    // the body's own ragdoll, built in the group's frame from its posed start (at rest: no carried-over motion)
    const t = o.target;
    const target: RagdollTarget = {
      root: obj, scale: t.scale, coated: t.coated, girth: t.girth, ragdollRig: t.ragdollRig,
      bone: name => t.bone(name),
      boneVelocity: (_name, out) => out.set(0, 0, 0),
      beginRagdoll: () => t.beginRagdoll(),
      setCullSphere: centre => this.cull(centre),
    };
    this.ragdoll = inParentFrame(obj, () => new Ragdoll(target, null, {world: w, material: flesh, statics: null}));
    // each part's place along the body and its pose on the feed line (the straight body laid along it, shoulders along the mouth)
    feedLine(o.aisle, CHIPPER_VIEW.body.tilt1, o.end, this.line);
    this.out.copy(this.line);
    const Q = o.fed.orient(this.line, o.long, new THREE.Quaternion());
    const inv = obj.quaternion.clone().invert();
    for (const part of this.ragdoll.parts) {
      const b = part.body;
      const rel = new THREE.Vector3(b.position.x, b.position.y, b.position.z).sub(obj.position).applyQuaternion(inv).sub(f.crown);
      const chain = rel.dot(f.axis);
      const q = Q.clone().multiply(inv.clone().multiply(new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)));
      this.parts.push({part, body: b, chain, off: rel.applyQuaternion(Q), q, taken: false, forced: false, ghost: false});
    }
    // already in (the posed start's depth; at least the crown-most part: the machine holds it from the start) — taken at once; the
    // rest free (a start inside the machine's boxes: the floor only, until clear)
    this.depth = feedDepth(o.p, this.len);
    const all = o.p >= F.allBy;
    let first = this.parts[0];
    for (const fp of this.parts) if (fp.chain < first.chain) first = fp;
    for (const fp of this.parts) {
      if (all || fp === first || fp.chain < this.depth) { this.take(fp, false); continue; }
      fp.body.collisionFilterMask = FREE_MASK;
      if (this.insideMachine(fp)) { fp.ghost = true; fp.body.collisionFilterMask = GROUP_FLOOR; this.stats.ghosts++; }
    }
  }

  /** Parts taken by the machine (QA). */
  get taken(): number {
    let n = 0;
    for (const fp of this.parts) if (fp.taken) n++;
    return n;
  }

  /**
   * One frame of the feed at job progress `p` (0..1), `t` the grind clock (s, the machine's tremor). The crown's depth moves from where
   * it was to feedDepth(p) over the frame's sub-steps; the bones follow. false = the feed failed (the runtime restores and poses it).
   */
  step(dt: number, p: number, t: number): boolean {
    const F = CHIPPER_FEED;
    if (this.failed) return false;
    const d = Math.min(Math.max(0, dt), F.step * F.maxSub);
    if (!(d > 0)) return true;
    const n = Math.max(1, Math.ceil(d / F.step - 1e-6)), h = d / n;
    const s0 = this.depth, s1 = Math.max(s0, feedDepth(p, this.len)), all = p >= F.allBy;
    for (let k = 1; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      this.drive(s, h, t - d + h * k, all);
      this.world.step(h);
      this.settle(h);
      this.stats.steps++;
    }
    this.depth = s1;
    if (!this.healthy()) { this.failed = true; return false; }
    this.ragdoll.sync(false);
    return true;
  }

  /** The bones exactly as they were before the feed (the posed fallback). */
  restore(): void {
    restoreBones(this.snap);
    this.obj.updateMatrixWorld(true);
  }

  /** The private world goes (the body's object stays: the runtime disposes it through the corpse system). */
  dispose(): void {
    for (const j of this.ragdoll.joints) this.world.removeConstraint(j);
    for (const b of this.world.bodies.slice()) this.world.removeBody(b);
  }

  /** QA: how far it is in. */
  qa(): {parts: number; taken: number; forced: number; depth: number; failed: boolean; steps: number; ghosts: number; contained: number; capped: number; peakFree: number} {
    return {parts: this.parts.length, taken: this.taken, forced: this.stats.forced, depth: +this.depth.toFixed(3), failed: this.failed, steps: this.stats.steps,
      ghosts: this.stats.ghosts, contained: this.stats.contained, capped: this.stats.capped, peakFree: +this.stats.peakFree.toFixed(2)};
  }

  // --- the draw ------------------------------------------------------------------------------------------------------

  private take(fp: FeedPart, forced: boolean): void {
    const b = fp.body;
    fp.taken = true;
    fp.forced = forced;
    fp.ghost = false;
    b.type = CANNON.Body.KINEMATIC; // the machine's grip: it moves as driven, no weight, no contacts, an anchor for its joints
    b.collisionFilterMask = 0;
    b.force.set(0, 0, 0);
    b.torque.set(0, 0, 0);
    this.stats.taken++;
    if (forced) this.stats.forced++;
  }

  /** The part's centre is in the hopper's mouth (its column, below the rim + CHIPPER_FEED.over). */
  private inMouth(b: CANNON.Body): boolean {
    const F = CHIPPER_FEED, A = CHIPPER_ANCHORS, c = this.o.place, m = toModel(c, b.position.x, b.position.z, tm);
    return Math.abs(m.x - A.hopper.x) < A.hopperMouth.x / 2 + F.margin && Math.abs(m.z - A.hopper.z) < A.hopperMouth.z / 2 + F.margin
      && b.position.y < this.o.hopper.y + F.over;
  }

  /** Any of the part's spheres' centres inside one of the machine's boxes (not the floor). */
  private insideMachine(fp: FeedPart): boolean {
    const c = this.o.place, b = fp.body;
    for (const l of fp.part.local) {
      b.pointToWorldFrame(l.c, cv);
      const m = toModel(c, cv.x, cv.z, tm), y = cv.y - c.floorY;
      for (const x of this.boxes) if (!x.floor && m.x > x.x0 && m.x < x.x1 && y > x.y0 && y < x.y1 && m.z > x.z0 && m.z < x.z1) return true;
    }
    return false;
  }

  /** Before a sub-step at crown depth `s`: parts whose turn it is are taken; the taken ones follow the line, the next ones are sucked in. */
  private drive(s: number, h: number, t: number, all: boolean): void {
    const F = CHIPPER_FEED, B = CHIPPER_VIEW.body, M = this.o.hopper, L = this.line, w = 2 * Math.PI;
    // the machine's tremor on the grip (the posed feed's shake)
    const jx = B.shake * Math.sin(w * 13 * t), jz = B.shake * 0.7 * Math.sin(w * 17 * t + 1.3), jy = B.shake * 0.5 * Math.sin(w * 11 * t + 0.6);
    for (const fp of this.parts) {
      if (!fp.taken && (all || fp.chain < s + F.lead)) {
        const inside = this.inMouth(fp.body);
        if (all || inside || fp.chain < s - F.deadline) this.take(fp, !inside);
      }
    }
    this.aimOut(h);
    for (const fp of this.parts) {
      const b = fp.body;
      if (fp.taken) {
        // its point on the line: the crown s m in, this part `off` from it
        tv.set(M.x + jx, M.y + jy, M.z + jz).addScaledVector(L, -s).add(fp.off);
        tv.x -= b.position.x; tv.y -= b.position.y; tv.z -= b.position.z;
        tv.multiplyScalar(1 / F.tau);
        if (tv.lengthSq() > F.vMax * F.vMax) tv.setLength(F.vMax);
        b.velocity.set(tv.x, tv.y, tv.z);
        // its orientation on the line, bent toward the body still outside while it is just past the mouth: the shortest turn there,
        // within tau
        const bent = Math.min(1, Math.max(0, 1 - (s - fp.chain) / F.bend));
        tv2.copy(L).multiplyScalar(1 - bent).addScaledVector(this.out, bent);
        if (bent > 0 && tv2.lengthSq() > 1e-6) tq.setFromUnitVectors(L, tv2.normalize()).multiply(fp.q); else tq.copy(fp.q);
        tq2.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).invert();
        tq.multiply(tq2);
        if (tq.w < 0) tq.set(-tq.x, -tq.y, -tq.z, -tq.w);
        const sin = Math.hypot(tq.x, tq.y, tq.z);
        if (sin > 1e-6) {
          const ang = 2 * Math.atan2(sin, tq.w), k = Math.min(ang / F.tau, F.wMax) / sin;
          b.angularVelocity.set(tq.x * k, tq.y * k, tq.z * k);
        } else b.angularVelocity.set(0, 0, 0);
      } else if (fp.chain < s + F.reach) {
        // the suction: toward a point just above the mouth (over the rim, then in)
        tv2.set(M.x - b.position.x, M.y + F.aim - b.position.y, M.z - b.position.z);
        const dist = tv2.length();
        if (dist > 0.05) { const k = b.mass * F.suck / dist; b.force.x += tv2.x * k; b.force.y += tv2.y * k; b.force.z += tv2.z * k; }
      }
    }
  }

  /** The smoothed direction from the mouth toward the free parts' centre of mass (kept as it was once every part is taken). */
  private aimOut(h: number): void {
    const M = this.o.hopper;
    let m = 0, x = 0, y = 0, z = 0;
    for (const fp of this.parts) {
      if (fp.taken) continue;
      const b = fp.body, p = b.position;
      x += p.x * b.mass; y += p.y * b.mass; z += p.z * b.mass; m += b.mass;
    }
    if (m <= 0) return;
    tv.set(x / m - M.x, y / m - M.y, z / m - M.z);
    if (tv.lengthSq() < 0.0025) return;
    tv.normalize();
    if (!this.outSeen) { this.out.copy(tv); this.outSeen = true; return; }
    this.out.lerp(tv, 1 - Math.exp(-h / CHIPPER_FEED.outLag)).normalize();
  }

  /** After a sub-step: joint friction / start-up limits (the corpse ragdoll's), the free parts' caps, ghosts released, the car's walls. */
  private settle(h: number): void {
    const F = CHIPPER_FEED, R = this.o.bounds;
    for (const j of this.ragdoll.joints) { j.relax(h); j.damp(h, RAGDOLL_TUNING.jointDamping); }
    for (const fp of this.parts) {
      if (fp.taken) continue;
      const b = fp.body, v = b.velocity.length(), om = b.angularVelocity.length();
      if (v > this.stats.peakFree) this.stats.peakFree = v;
      if (v > F.vFree) { b.velocity.scale(F.vFree / v, b.velocity); this.stats.capped++; }
      if (om > F.wFree) { b.angularVelocity.scale(F.wFree / om, b.angularVelocity); this.stats.capped++; }
      if (fp.ghost && !this.insideMachine(fp)) { fp.ghost = false; b.collisionFilterMask = FREE_MASK; }
      // inside the car (never through its walls / ceiling): back in, the outward speed gone
      const p = b.position, hw = R.halfWidth - F.wallPad;
      let out = false;
      if (p.x < R.x0 + F.wallPad) { p.x = R.x0 + F.wallPad; if (b.velocity.x < 0) b.velocity.x = 0; out = true; }
      if (p.x > R.x1 - F.wallPad) { p.x = R.x1 - F.wallPad; if (b.velocity.x > 0) b.velocity.x = 0; out = true; }
      if (p.z < -hw) { p.z = -hw; if (b.velocity.z < 0) b.velocity.z = 0; out = true; }
      if (p.z > hw) { p.z = hw; if (b.velocity.z > 0) b.velocity.z = 0; out = true; }
      if (p.y > R.ceilY - F.wallPad) { p.y = R.ceilY - F.wallPad; if (b.velocity.y > 0) b.velocity.y = 0; out = true; }
      if (p.y < R.floorY) { p.y = R.floorY; if (b.velocity.y < 0) b.velocity.y = 0; out = true; }
      if (out) this.stats.contained++;
    }
  }

  /** Every part finite and near the machine. */
  private healthy(): boolean {
    const F = CHIPPER_FEED, M = this.o.hopper;
    for (const fp of this.parts) {
      const p = fp.body.position, q = fp.body.quaternion;
      if (!Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z + q.w)) return false;
      if (Math.abs(p.x - M.x) > F.away || Math.abs(p.y - M.y) > F.away || Math.abs(p.z - M.z) > F.away) return false;
    }
    return true;
  }

  /** The ragdoll's cull sphere (its pelvis, in the group's frame) -> the body's skinned bounds in the world. */
  private cull(centre: THREE.Vector3): void {
    const parent = this.obj.parent;
    this.cullAt.copy(centre);
    if (parent) { parent.updateWorldMatrix(true, false); this.cullAt.applyMatrix4(parent.matrixWorld); }
    this.o.target.setCullSphere(this.cullAt, CHIPPER_FEED.cull * this.o.target.scale);
  }
}
