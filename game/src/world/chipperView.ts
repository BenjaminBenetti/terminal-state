// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER): the train chipper's VISUALS (world/chipper.ts drives them):
//  - ChipperView: the machine at its placement (world/chipperPlace.ts) in the TRAIN-LOCAL frame — the cooked model (world/chipperSpec.ts
//    CHIPPER_MODEL, a clone of the prop library's GLB; no model = no machine visual), a subtle deterministic VIBRATION while it grinds, and
//    the honest GAUGE on its control box (CHIPPER_ANCHORS.panel): a code-driven emissive progress bar (the job's real progress), a run
//    lamp and a credit lamp (fuel waiting in the machine) — a dynamic display, emissive intensity / scale only (no new programs).
//  - FedBody: the fed body's real model (the corpse system's object) going HEAD FIRST into the hopper mouth: tilted over the lip at
//    first, straightening as it sinks with the job's progress in small lunges (a monotonic staircase: never back out), legs last; at
//    completion the runtime disposes it. Its head / feet are found from the rig's bones ('Head', 'L_Foot' / 'R_Foot', 'Hips': the enemy
//    rigs' names) in its own frame, whatever pose it arrives in (carry pose, or a rebuilt resting body after a load); a model without
//    those bones falls back to its bounds' longest axis. What sinks below the rim is hidden by the machine's casing and the car floor.

import * as THREE from 'three';
import {CHIPPER_ANCHORS} from './chipperSpec';
import type {ChipperPlacement} from './chipperPlace';

/** Tuning (one place). */
export const CHIPPER_VIEW = {
  /** Vibration while grinding: position (m) and yaw (rad) amplitudes; a few incommensurate frequencies (Hz). */
  shake: {pos: 0.0022, y: 0.0012, yaw: 0.0028, hz: [23, 31, 17] as const},
  /** The gauge (m, model frame on the control box face): plate, bar, lamps. */
  gauge: {plateW: 0.15, plateH: 0.06, plateD: 0.012, barW: 0.13, barH: 0.018, barD: 0.006, lamp: 0.014},
  /** The fed body: tilt from vertical toward the aisle at first / at the end (rad), lunges over the job, first / last depth past the
   *  crown (m), the crown above the 'Head' bone and the sole below the foot bones (m). */
  body: {tilt0: 0.9, tilt1: 0.08, straightBy: 0.55, lunges: 8, lungeDepth: 0.8, s0: 0.22, past: 0.1, crown: 0.12, sole: 0.08, shake: 0.012},
} as const;

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The sink staircase (0..1 -> 0..1, monotonic): progress with `n` lunges (speed 1 - d·cos). */
export function lungeCurve(p: number, n: number = CHIPPER_VIEW.body.lunges, d: number = CHIPPER_VIEW.body.lungeDepth): number {
  const q = Math.max(0, Math.min(1, p));
  return q - d * Math.sin(2 * Math.PI * n * q) / (2 * Math.PI * n);
}

/** How hard the body is being pulled in right now (0..1: the staircase's slope, normalised) — the spray's lunge factor. */
export function lungeRate(p: number, n: number = CHIPPER_VIEW.body.lunges, d: number = CHIPPER_VIEW.body.lungeDepth): number {
  return (1 - d * Math.cos(2 * Math.PI * n * Math.max(0, Math.min(1, p)))) / (1 + d);
}

export class ChipperView {
  /** The machine at its placement (train-local, yaw PI): a child of the chipper's group. */
  readonly root = new THREE.Group();
  /** The vibrating part (model + gauge), model frame. */
  readonly shake = new THREE.Group();
  model: THREE.Object3D | null = null;
  /** The source the model was cloned from (the library's GLB scene). */
  private modelSrc: THREE.Object3D | null = null;
  readonly gauge = new THREE.Group();
  private readonly bar: THREE.Mesh;
  private readonly barMat: THREE.MeshStandardMaterial;
  private readonly runMat: THREE.MeshStandardMaterial;
  private readonly creditMat: THREE.MeshStandardMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(readonly place: ChipperPlacement) {
    this.root.name = 'train-chipper';
    this.root.position.set(place.x, place.floorY, place.z);
    this.root.rotation.set(0, place.yaw, 0);
    this.shake.name = 'train-chipper-shake';
    this.root.add(this.shake);
    // --- the gauge on the control box face (+Z of the model frame) ---
    const G = CHIPPER_VIEW.gauge, P = CHIPPER_ANCHORS.panel;
    const plateMat = new THREE.MeshStandardMaterial({name: 'chipper-gauge-plate', color: 0x1b1d1f, roughness: 0.7, metalness: 0.3});
    const trackMat = new THREE.MeshStandardMaterial({name: 'chipper-gauge-track', color: 0x0c0d0e, roughness: 0.9, metalness: 0});
    this.barMat = new THREE.MeshStandardMaterial({name: 'chipper-gauge-bar', color: 0x3a2a12, roughness: 0.5, metalness: 0, emissive: 0xff9a2a, emissiveIntensity: 0});
    this.runMat = new THREE.MeshStandardMaterial({name: 'chipper-gauge-run', color: 0x3a1210, roughness: 0.5, metalness: 0, emissive: 0xff3a1a, emissiveIntensity: 0});
    this.creditMat = new THREE.MeshStandardMaterial({name: 'chipper-gauge-credit', color: 0x123a16, roughness: 0.5, metalness: 0, emissive: 0x4dff5a, emissiveIntensity: 0});
    this.mats.push(plateMat, trackMat, this.barMat, this.runMat, this.creditMat);
    const plate = new THREE.BoxGeometry(G.plateW, G.plateH, G.plateD);
    plate.translate(0, 0, G.plateD / 2);
    const track = new THREE.BoxGeometry(G.barW, G.barH, G.barD * 0.5);
    track.translate(0, -0.008, G.plateD + G.barD * 0.25);
    const bar = new THREE.BoxGeometry(G.barW, G.barH * 0.8, G.barD);
    bar.translate(G.barW / 2, 0, 0); // grows from its left end (the viewer's left: model -X)
    const lamp = new THREE.BoxGeometry(G.lamp, G.lamp, G.barD);
    this.geos.push(plate, track, bar, lamp);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => { const o = new THREE.Mesh(g, m); o.name = name; o.raycast = () => {}; this.gauge.add(o); return o; };
    mk(plate, plateMat, 'chipper-gauge-plate');
    mk(track, trackMat, 'chipper-gauge-track');
    this.bar = mk(bar, this.barMat, 'chipper-gauge-bar');
    this.bar.position.set(-G.barW / 2, -0.008, G.plateD + G.barD / 2 + 0.0005);
    this.bar.scale.x = 0.001;
    const run = mk(lamp, this.runMat, 'chipper-gauge-run');
    run.position.set(G.plateW / 2 - 0.022, 0.016, G.plateD + G.barD / 2);
    const credit = mk(lamp, this.creditMat, 'chipper-gauge-credit');
    credit.position.set(G.plateW / 2 - 0.044, 0.016, G.plateD + G.barD / 2);
    this.gauge.name = 'train-chipper-gauge';
    this.gauge.position.set(P.x, P.y, P.z);
    this.gauge.visible = false; // mounted on the model's control box: shown with the model
    this.shake.add(this.gauge);
  }

  /**
   * The cooked model (the prop library's GLB scene; null = none yet). Cloned once per source (geometry / materials shared with the
   * library: never disposed here). Returns true when the model is (now) shown.
   */
  setModel(src: THREE.Object3D | null): boolean {
    if (!src || src === this.modelSrc) return !!this.model;
    if (this.model) this.shake.remove(this.model);
    const m = src.clone(true);
    m.name = 'train-chipper-model';
    m.traverse(o => { o.raycast = () => {}; }); // the collision box is the machine for rays (world/playerTrain.ts statics)
    this.shake.add(m);
    this.model = m;
    this.modelSrc = src;
    this.gauge.visible = true;
    return true;
  }

  /** The gauge: the job's progress (0..1), grinding (the run lamp pulses), fuel waiting (the credit lamp), `t` = a clock (s). */
  setGauge(progress: number, grinding: boolean, credit: boolean, t: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.bar.scale.x = Math.max(0.001, p);
    this.barMat.emissiveIntensity = p > 0 ? (grinding ? 1.6 : 0.7) : 0;
    this.runMat.emissiveIntensity = grinding ? 1.2 + 0.8 * Math.sin(t * 9) : 0;
    this.creditMat.emissiveIntensity = credit ? 1.4 : 0;
  }

  /** The machine trembles while grinding (deterministic in `t`); at rest exactly in place. */
  vibrate(t: number, on: boolean): void {
    if (!on) { this.shake.position.set(0, 0, 0); this.shake.rotation.set(0, 0, 0); return; }
    const S = CHIPPER_VIEW.shake, [a, b, c] = S.hz, w = 2 * Math.PI;
    this.shake.position.set(S.pos * Math.sin(w * a * t) * 0.7 + S.pos * 0.3 * Math.sin(w * c * t + 1.1), S.y * Math.abs(Math.sin(w * b * t + 0.4)), S.pos * Math.sin(w * b * t + 2.3) * 0.6);
    this.shake.rotation.set(0, S.yaw * Math.sin(w * c * t + 0.7), 0);
  }

  /** QA: the gauge's bar fraction and lamp states. */
  gaugeState(): {bar: number; run: boolean; credit: boolean; visible: boolean} {
    return {bar: +this.bar.scale.x.toFixed(3), run: this.runMat.emissiveIntensity > 0, credit: this.creditMat.emissiveIntensity > 0, visible: this.gauge.visible};
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

const v = () => new THREE.Vector3();

/** The fed body's measured frame (its own, scale applied): crown point and the crown -> sole axis, its length. */
export interface BodyFrame { crown: THREE.Vector3; axis: THREE.Vector3; len: number; bones: boolean }

/** Measure a body's head / feet in its own frame (bones first, else its bounds' longest axis). */
export function measureBody(obj: THREE.Object3D): BodyFrame {
  const B = CHIPPER_VIEW.body;
  obj.updateWorldMatrix(true, true); // its ancestors too: the bones' world points and the inverse agree
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const local = (o: THREE.Object3D | undefined): THREE.Vector3 | null => o ? o.getWorldPosition(v()).applyMatrix4(inv).multiply(obj.scale) : null;
  const head = local(obj.getObjectByName('Head'));
  const lf = local(obj.getObjectByName('L_Foot')), rf = local(obj.getObjectByName('R_Foot'));
  const feet = lf && rf ? lf.add(rf).multiplyScalar(0.5) : lf ?? rf ?? local(obj.getObjectByName('Hips'));
  if (head && feet && head.distanceTo(feet) > 0.3) {
    const axis = feet.clone().sub(head).normalize();
    const crown = head.clone().addScaledVector(axis, -B.crown);
    return {crown, axis, len: head.distanceTo(feet) + B.crown + B.sole, bones: true};
  }
  // no rig: the bounds (own frame) — the longest axis; upright bodies keep their head up
  const box = new THREE.Box3().setFromObject(obj).applyMatrix4(inv);
  if (box.isEmpty()) return {crown: new THREE.Vector3(0, 1.75 * obj.scale.y, 0), axis: new THREE.Vector3(0, -1, 0), len: 1.75 * obj.scale.y, bones: false};
  const size = box.getSize(v()).multiply(obj.scale), c = box.getCenter(v()).multiply(obj.scale), min = box.min.clone().multiply(obj.scale), max = box.max.clone().multiply(obj.scale);
  const k: 'x' | 'y' | 'z' = size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z';
  const crown = c.clone(); crown[k] = max[k];
  const sole = c.clone(); sole[k] = min[k];
  return {crown, axis: sole.clone().sub(crown).normalize(), len: size[k], bones: false};
}

/** The fed body: its object, its measured frame, where it is going (train-local hopper mouth and the aisle direction). */
export class FedBody {
  readonly frame: BodyFrame;
  private readonly u = v();
  private readonly q = new THREE.Quaternion();
  private readonly tip = v();

  constructor(readonly obj: THREE.Object3D, readonly uid: number) {
    this.frame = measureBody(obj);
  }

  /**
   * Pose for job progress `p` (0..1): the crown `s` m past the hopper mouth along the body's line, the line tilted from vertical toward
   * the aisle (`aisle`: a unit horizontal train-local direction) and straightening as it sinks; `shakeT` (s) jitters it while grinding.
   */
  place(hopper: {x: number; y: number; z: number}, aisle: {x: number; z: number}, p: number, shakeT: number | null): void {
    const B = CHIPPER_VIEW.body, f = this.frame;
    const tilt = B.tilt1 + (B.tilt0 - B.tilt1) * (1 - smooth(0, B.straightBy, p));
    // u: from the crown (inside) out toward the soles — up, leaning over the lip into the aisle
    this.u.set(aisle.x * Math.sin(tilt), Math.cos(tilt), aisle.z * Math.sin(tilt));
    const s = B.s0 + (f.len + B.past - B.s0) * lungeCurve(p);
    this.q.setFromUnitVectors(f.axis, this.u);
    // the crown sits s m inside the mouth along -u
    this.tip.set(hopper.x, hopper.y, hopper.z).addScaledVector(this.u, -s);
    const o = this.obj;
    o.quaternion.copy(this.q);
    o.position.copy(f.crown).applyQuaternion(this.q).negate().add(this.tip);
    if (shakeT !== null) {
      const w = 2 * Math.PI;
      o.position.x += B.shake * Math.sin(w * 13 * shakeT);
      o.position.z += B.shake * 0.7 * Math.sin(w * 17 * shakeT + 1.3);
      o.position.y += B.shake * 0.5 * Math.sin(w * 11 * shakeT + 0.6);
    }
  }

  /** The exposed end (soles) height above the mouth at progress p (m; tests: it ends inside). */
  exposedTop(p: number): number {
    const B = CHIPPER_VIEW.body, f = this.frame;
    const tilt = B.tilt1 + (B.tilt0 - B.tilt1) * (1 - smooth(0, B.straightBy, p));
    const s = B.s0 + (f.len + B.past - B.s0) * lungeCurve(p);
    return (f.len - s) * Math.cos(tilt);
  }
}
