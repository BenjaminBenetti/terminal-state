// First-person eat / drink / apply animation (iteration 04, user feedback #1): the gun lowers out
// of view, the ACTUAL item model (models.item_* via world/pickups makeSupplyMesh, or its
// procedural stand-in) comes up from the hand toward the mouth, tips (bottles, cans, cartons,
// tins, cups, the chip bag) or takes bites (chocolate) for the use duration, then goes away and
// the gun comes back up. Bandage / med kit are applied low in front of the body instead.
//
// Purely visual: the game's timed use (game.ts `use`) stays authoritative for consumption. The
// item is parented to the viewmodel camera, so it draws in the same overlay pass as the gun.
//
// State machine (phase):
//   idle -> stow (gun lowers, swap mode only) -> raise (item hand/below -> face) -> use
//   use --complete()--> finish (face -> hand when the stack stays in hand, else out of view)
//   stow/raise/use --cancel()--> cancel (item drops out of view, nothing consumed)
//   finish/cancel -> restore (gun rises back) -> idle;  reset() -> idle immediately.
// `busy` (phase !== idle) keeps the weapon lowered: no firing / aiming / reloading until it is back.

import * as THREE from 'three';
import {itemDef} from '../items/items';

/**
 * hand  = the item is the held quick-slot item (viewmodel shows it): rises straight from the hand;
 * swap  = something else is held (a gun or another item): it lowers first, then the item comes up;
 * empty = nothing held: the item rises from below.
 */
export type ConsumeMode = 'hand' | 'swap' | 'empty';
export type ConsumePhase = 'idle' | 'stow' | 'raise' | 'use' | 'finish' | 'cancel' | 'restore';

export const CONSUME_TIMING = {stow: 0.18, raise: 0.28, finish: 0.26, cancel: 0.2, restore: 0.3};

export interface ConsumeViewHost {
  /** Viewmodel camera (Viewmodel.camera); the item is added as its child. */
  readonly camera: THREE.Object3D;
  /** 0 = gun in its normal pose … 1 = lowered fully out of view and hidden (viewmodel.ts). */
  setHolstered?(k: number): void;
}

interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion }

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const euler = (x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));

/**
 * Mirrors how the viewmodel carries a consumable in the hand: holder at the consumable hip offset
 * (viewmodel.ts consumables: 0.16, -0.17, -0.36; yaw 0.05, roll -0.04) with the item rotated
 * (0.5, -0.4, 0.15) inside it (game.ts load()).
 */
const HAND_POS = new THREE.Vector3(0.16, -0.17, -0.36);
const HAND_QUAT = euler(0, 0.05, -0.04).multiply(euler(0.5, -0.4, 0.15));
/** Mouth, in viewmodel-camera space (camera at the eyes looking down -Z; near plane 0.01). */
// Viewmodel camera is 54° vertical FOV: at 0.07 m the old mouth point (y -0.1) was below the frame and
// only the bottle's base showed. Keep the item's top inside the lower-centre of the view.
const MOUTH = new THREE.Vector3(0.015, -0.045, -0.14);
const BELOW = new THREE.Vector3(0.03, -0.36, 0);
const BELOW_TILT = euler(-0.7, 0, 0);

type Motion = 'tip' | 'bite' | 'bandage' | 'medkit';
interface Style {
  motion: Motion;
  /** Local point (item frame) that goes to the mouth / hands. */
  anchor: THREE.Vector3;
  /** Orientation applied before the tilt (maps the anchor direction to +Y). */
  base: THREE.Quaternion;
  /** Tilt toward the face (rad about camera X) at the start / end of the use. */
  a0: number;
  a1: number;
  yaw: number;
  roll: number;
  /** Shake / scoop amplitude (rad) for food that is tipped. */
  shake: number;
  target: THREE.Vector3;
}

function styleFor(itemId: string, box: THREE.Box3): Style {
  const def = itemDef(itemId);
  const top = new THREE.Vector3(0, box.max.y, 0);
  const centre = box.getCenter(new THREE.Vector3());
  const id = new THREE.Quaternion();
  const s: Style = {motion: 'tip', anchor: top, base: id, a0: 1.25, a1: 2.0, yaw: -0.18, roll: 0.08, shake: 0, target: MOUTH};
  if (def.verb === 'drink') return s;
  if (def.verb === 'eat') {
    switch (itemId) {
      case 'chocolate':
        // Bar held end-on, its +X end at the mouth (base: +X -> +Y), small bites.
        return {...s, motion: 'bite', anchor: new THREE.Vector3(box.max.x, centre.y, centre.z), base: euler(0, 0, Math.PI / 2), a0: 1.05, a1: 1.15, yaw: -0.12, roll: 0.3, target: new THREE.Vector3(0.012, -0.05, -0.15)};
      case 'chips': return {...s, a0: 1.15, a1: 1.75, shake: 0.06, target: new THREE.Vector3(0.015, -0.05, -0.15)};
      case 'beans': return {...s, a0: 1.05, a1: 1.6, shake: 0.08, target: new THREE.Vector3(0.015, -0.05, -0.14)};
      case 'noodles': return {...s, a0: 1.0, a1: 1.5, shake: 0.07, target: new THREE.Vector3(0.015, -0.05, -0.14)};
      default: return {...s, motion: 'bite', a0: 1.0, a1: 1.1};
    }
  }
  // Medical: held low in front of the body.
  if (itemId === 'medkit') return {...s, motion: 'medkit', anchor: centre, target: new THREE.Vector3(0.0, -0.22, -0.46)};
  return {...s, motion: 'bandage', anchor: centre, target: new THREE.Vector3(0.02, -0.2, -0.3)};
}

export class ConsumeView {
  phase: ConsumePhase = 'idle';
  mode: ConsumeMode = 'swap';
  itemId: string | null = null;
  /** Gun holster level pushed to the host every update (0 normal … 1 hidden). */
  holster = 0;
  readonly group = new THREE.Group();
  readonly counts = {started: 0, completed: 0, cancelled: 0};
  lastCancel = '';
  private obj: THREE.Object3D | null = null;
  private style: Style | null = null;
  private readonly objects = new Map<string, {obj: THREE.Object3D; box: THREE.Box3}>();
  private phaseT = 0;
  private elapsed = 0;
  private total = 1;
  private useStart = 0;
  private keep = false;
  private from: Pose = {pos: new THREE.Vector3(), quat: new THREE.Quaternion()};
  private to: Pose = {pos: new THREE.Vector3(), quat: new THREE.Quaternion()};

  constructor(private readonly host: ConsumeViewHost, private readonly make: (itemId: string) => THREE.Object3D) {
    this.group.name = 'consume-view';
    this.group.visible = false;
    host.camera.add(this.group);
  }

  /** True until the gun is fully back: the weapon must stay lowered (no fire / aim / reload). */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  get itemVisible(): boolean {
    return this.group.visible;
  }

  /** A timed use began (`total` seconds, the game's use duration). */
  start(itemId: string, total: number, mode: ConsumeMode): void {
    this.itemId = itemId;
    this.mode = mode;
    this.total = Math.max(0.3, total);
    this.elapsed = this.useStart = this.phaseT = 0;
    this.keep = false;
    this.counts.started++;
    this.attach(itemId);
    if (mode === 'hand') {
      // The held copy hides instantly and this copy takes over at the same hand pose.
      this.holster = 1;
      this.from = {pos: HAND_POS.clone(), quat: HAND_QUAT.clone()};
      this.enter('raise');
      this.setPose(this.from);
    } else if (mode === 'swap' && this.holster < 1) {
      this.group.visible = false;
      this.enter('stow');
    } else {
      this.holster = 1;
      this.from = this.belowOf(this.consumePose(0));
      this.enter('raise');
      this.setPose(this.from);
    }
    this.apply();
  }

  /** The use finished and the item was consumed. `keepInHand`: the stack is still the held item. */
  complete(keepInHand: boolean): void {
    if (this.phase !== 'stow' && this.phase !== 'raise' && this.phase !== 'use') return;
    this.counts.completed++;
    this.keep = keepInHand && this.mode === 'hand';
    this.leave('finish', this.keep ? {pos: HAND_POS.clone(), quat: HAND_QUAT.clone()} : null);
  }

  /** Interrupted (slot switch, sprint, hit, menu, death): nothing consumed; the gun comes back. */
  cancel(reason = ''): void {
    if (this.phase !== 'stow' && this.phase !== 'raise' && this.phase !== 'use') return;
    this.counts.cancelled++;
    this.lastCancel = reason;
    this.leave('cancel', null);
  }

  /** Immediate clean state (new station / retry). */
  reset(): void {
    this.enter('idle');
    this.group.visible = false;
    this.holster = 0;
    this.itemId = null;
    this.apply();
  }

  update(dt: number): void {
    if (this.phase === 'idle') { this.apply(); return; }
    this.elapsed += dt;
    this.phaseT += dt;
    const T = CONSUME_TIMING;
    switch (this.phase) {
      case 'stow':
        this.holster = Math.min(1, this.holster + dt / T.stow);
        if (this.holster >= 1) {
          this.from = this.belowOf(this.consumePose(0));
          this.enter('raise');
          this.setPose(this.from);
        }
        break;
      case 'raise': {
        const k = clamp01(this.phaseT / T.raise);
        this.setPose(lerpPose(this.from, this.consumePose(0), ease(k)));
        if (k >= 1) { this.useStart = this.elapsed; this.enter('use'); }
        break;
      }
      case 'use':
        this.setPose(this.consumePose(clamp01((this.elapsed - this.useStart) / Math.max(0.2, this.total - this.useStart))));
        break;
      case 'finish':
      case 'cancel': {
        const k = clamp01(this.phaseT / (this.phase === 'finish' ? T.finish : T.cancel));
        this.setPose(lerpPose(this.from, this.to, ease(k)));
        if (k >= 1) this.endItem();
        break;
      }
      case 'restore':
        this.holster = Math.max(0, this.holster - dt / T.restore);
        if (this.holster <= 0) this.enter('idle');
        break;
    }
    this.apply();
  }

  qaState(): {phase: ConsumePhase; mode: ConsumeMode; itemId: string | null; holster: number; itemVisible: boolean; busy: boolean; counts: {started: number; completed: number; cancelled: number}; lastCancel: string; itemPos: number[] | null} {
    const p = this.obj && this.group.visible ? this.obj.position.toArray().map(v => +v.toFixed(3)) : null;
    return {phase: this.phase, mode: this.mode, itemId: this.itemId, holster: +this.holster.toFixed(3), itemVisible: this.group.visible, busy: this.busy, counts: {...this.counts}, lastCancel: this.lastCancel, itemPos: p};
  }

  // -------------------------------------------------------------------------------------------
  private enter(p: ConsumePhase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  private leave(p: 'finish' | 'cancel', to: Pose | null): void {
    if (this.phase === 'stow' || !this.group.visible) {
      // Never came on screen: just bring the gun back.
      this.group.visible = false;
      this.enter(this.holster > 0 ? 'restore' : 'idle');
      this.apply();
      return;
    }
    this.from = this.currentPose();
    this.to = to ?? this.belowOf(this.from);
    this.enter(p);
  }

  private endItem(): void {
    this.group.visible = false;
    if (this.mode === 'hand' && this.keep) {
      this.holster = 0; // the held copy reappears exactly where this one stopped
      this.enter('idle');
    } else this.enter(this.holster > 0 ? 'restore' : 'idle');
  }

  private apply(): void {
    this.host.setHolstered?.(this.holster);
  }

  private attach(itemId: string): void {
    let e = this.objects.get(itemId);
    if (!e) {
      const obj = this.make(itemId);
      obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.renderOrder = 1; } });
      obj.updateMatrixWorld(true);
      e = {obj, box: new THREE.Box3().setFromObject(obj)};
      if (e.box.isEmpty()) e.box.set(new THREE.Vector3(-0.04, 0, -0.04), new THREE.Vector3(0.04, 0.15, 0.04));
      this.objects.set(itemId, e);
    }
    if (this.obj && this.obj !== e.obj) this.group.remove(this.obj);
    this.obj = e.obj;
    this.group.add(e.obj);
    this.style = styleFor(itemId, e.box);
  }

  private setPose(p: Pose): void {
    if (!this.obj) return;
    this.obj.position.copy(p.pos);
    this.obj.quaternion.copy(p.quat);
    this.group.visible = true;
  }

  private currentPose(): Pose {
    return {pos: this.obj ? this.obj.position.clone() : new THREE.Vector3(), quat: this.obj ? this.obj.quaternion.clone() : new THREE.Quaternion()};
  }

  private belowOf(p: Pose): Pose {
    return {pos: p.pos.clone().add(BELOW), quat: BELOW_TILT.clone().multiply(p.quat)};
  }

  /** Pose at the face for use progress k (0..1), with the motion's time-based detail. */
  private consumePose(k: number): Pose {
    const s = this.style!;
    const t = this.elapsed;
    let q: THREE.Quaternion;
    const target = s.target.clone();
    if (s.motion === 'medkit') {
      q = euler(0.75 + Math.sin(t * 9) * 0.03, -0.1, 0);
      target.x += Math.sin(t * 6) * 0.008;
    } else if (s.motion === 'bandage') {
      // Unrolling around the forearm: the roll orbits a little and spins about its own axis (X).
      q = euler(0.3, 0.6, 0).multiply(euler(t * 7, 0, 0));
      target.x += Math.sin(t * 5) * 0.03;
      target.y += Math.cos(t * 5) * 0.012;
    } else {
      let a = s.a0 + (s.a1 - s.a0) * ease(k);
      let roll = s.roll;
      if (s.motion === 'bite') {
        // Quick bite in, slower back out, every 0.55 s.
        const c = (t % 0.55) / 0.55;
        const push = c < 0.3 ? ease(c / 0.3) : 1 - ease((c - 0.3) / 0.7);
        a += push * 0.15;
        target.z += push * 0.022;
        target.y += push * 0.01;
      } else {
        a += Math.sin(t * 7) * 0.03; // swallowing
        target.y += Math.sin(t * 7) * 0.003;
        roll += Math.sin(t * 16) * s.shake;
      }
      q = euler(a, s.yaw, roll, 'YXZ').multiply(s.base);
    }
    const pos = target.sub(s.anchor.clone().applyQuaternion(q));
    return {pos, quat: q};
  }
}

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {pos: a.pos.clone().lerp(b.pos, k), quat: a.quat.clone().slerp(b.quat, k)};
}
