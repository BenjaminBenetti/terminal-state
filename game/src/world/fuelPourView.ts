// Task studio-beta-fuel-feedback-20261106-064128-01 (lane POUR): the VISIBLE can pour at the train's fuel cap (world/fuelPort.ts).
//
// User feedback: "See an animation of the can being poured into train". While FuelPortSystem's timed pour runs, a world-space copy of
// the fuel can (the item template itself: shared geometry / materials / Meshy maps — no new asset, no hands, no camera change) is lifted
// from where the held can sits to beside the (uncapped) filler neck, tipped past its side so its spout comes down over the neck, pours a
// thin translucent amber stream into it (a few drops run down it), then is righted and lowered back to the hand, gone when the pour
// completes.
//
// TIMELINE (the transaction's own clock `t` of FUEL_PORT.pourS drives every phase, so nothing is used before the real completion):
//   lift    0 .. liftS               hand -> a waiting pose up beside the neck (a small arc; a third of the tilt already applied);
//   tilt    .. + tiltS               the can rolls over, its spout tip guided down to POUR_VIEW.tipAt above the neck's mouth;
//   pour    .. total - settleS       the stream runs spout -> into the neck (the can rocks a little about its pinned spout);
//   settle  .. total                 stream off; the can swings back to the hand (re-read at the settle start); the pour completes at
//                                    `total` (FuelPortSystem.complete: one can used) and the view is hidden.
// A cancel at any moment hides it at once (FuelPortSystem.cancel: nothing used).
//
// FRAME: `root` is in the TRAIN-LOCAL frame (world/playerTrainSpec.ts: +X front, +Y up, -Z the platform side); FuelPortSystem keeps it a
// child of the cap fixture (offset by -fuelPortLocal()), so it moves with the car and belongs to the 'fuel-port' warm-up pool.
//
// THE CAN'S SPOUT (world/fuelCanModel.ts frame: origin bottom-centre, +Y up, front +Z): on the delivered GLB the spout cap is the top
// corner at -X, its axis leaning out ~45 deg (measured on the model's vertices: the extreme along (-0.71, 0.71, 0) sits at x -0.146 /
// y 0.436 of the 0.316 x 0.47 can). POUR_VIEW.spoutTip says so in FRACTIONS of the model's own bounds, so a resized can (the smaller
// medpack-size can) keeps its spout without a code change.
//
// RENDERING: built once (lazily, after the boot assets: the item template must be the loaded GLB) and kept for the session. The can
// shares the template's materials (no clone); the stream and its drops share ONE transparent FrontSide material (single pass: no
// double-sided transparent variants the warm-up would miss); castShadow false; raycast disabled on every mesh; no per-frame
// allocation (scratch vectors / quaternions); nothing shared is ever disposed.

import * as THREE from 'three';
import {makeSupplyMesh} from './pickups';

/** Tuning (one place). Train-local metres / radians / seconds. */
export const POUR_VIEW = {
  /** Phase lengths inside the pour (s): the lift, the tilt and the settle; the pour phase is what remains of FUEL_PORT.pourS. */
  liftS: 0.55,
  tiltS: 0.3,
  settleS: 0.45,
  /** The spout tip in fractions of the model bounds (x of the width from the centre, y of the height from the base, z of the depth from the centre). */
  spoutTip: [-0.45, 0.93, 0] as const,
  /** The spout's axis in the model frame (out of the tip: up and out to -X). */
  spoutAxis: [-Math.SQRT1_2, Math.SQRT1_2, 0] as const,
  /**
   * POUR POSE (chosen on CPU renders from the platform eye: the can must not hide the neck or the stream). The can's broad front
   * (+Z) faces out to the platform (its plane almost parallel to the car side, tipped up by `faceUp` toward the eye), the can is rolled
   * past its side — its top `tipBeyond` rad below horizontal, toward +X — so its spout corner is the lowest point and the spout points
   * DOWN over the neck; the body sits up and to the -X side (screen right from the platform) of the neck, clear of it.
   */
  faceUp: 0,
  tipBeyond: 0.45,
  /** The spout tip's pour point relative to the neck mouth (m, train-local; then moved out as far as the clearance needs). */
  tipAt: {x: -0.012, y: 0.07, z: 0},
  /** Clearance (m) of the posed can's bounds in front of the housing plate (the spout's own corners: the skin), and the spout's zone (a fraction of the can's largest size). */
  clearance: 0.006,
  spoutZone: 0.35,
  /** The waiting pose at the end of the lift: the tip this far from its pour point (m, train-local), this fraction of the tilt applied. */
  approach: {x: -0.06, y: 0.1, z: -0.07, tilt: 0.33},
  /** Height of the lift's / settle's arc (m). */
  arc: 0.07,
  /** The pour's rocking about the pinned spout (rad, Hz). */
  rock: {amp: 0.035, hz: 2.1},
  /** The stream: radius, how deep into the neck it runs (m), its grow / detach time (s), the drops (count, radius, runs per second). */
  stream: {r: 0.0085, inside: 0.004, growS: 0.08, drops: 3, dropR: 0.0095, flowHz: 2.4},
} as const;

export type PourPhase = 'lift' | 'tilt' | 'pour' | 'settle';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (k: number) => k * k * (3 - 2 * k);

/** Which phase a pour `t` seconds in (of `total`) is in, and how far through it (0..1). `out` is reused (no allocation). */
export function pourPhaseAt(t: number, total: number, out: {phase: PourPhase; k: number; tp: number; rem: number} = {phase: 'lift', k: 0, tp: 0, rem: 0}): {phase: PourPhase; k: number; tp: number; rem: number} {
  const P = POUR_VIEW, a = P.liftS, b = a + P.tiltS, c = Math.max(b, total - P.settleS);
  if (t < a) { out.phase = 'lift'; out.k = clamp01(t / a); }
  else if (t < b) { out.phase = 'tilt'; out.k = clamp01((t - a) / P.tiltS); }
  else if (t < c) { out.phase = 'pour'; out.k = clamp01((t - b) / Math.max(1e-6, c - b)); }
  else { out.phase = 'settle'; out.k = clamp01((t - c) / Math.max(1e-6, total - c)); }
  out.tp = t - b; // seconds into the pour phase (negative before it)
  out.rem = c - t; // seconds left of the pour phase
  return out;
}

/** The hand's pose for the can (train-local model origin + orientation); false = unknown (the last one is kept). */
export type HandPose = (pos: THREE.Vector3, q: THREE.Quaternion) => boolean;

interface V3 { x: number; y: number; z: number }

export class FuelPourView {
  /** Train-local frame (positioned by the owner). Hidden while no pour runs. */
  readonly root = new THREE.Group();
  /** The can (the item template's copy; origin = the model's bottom-centre). */
  readonly can: THREE.Object3D;
  /** The fuel stream (a unit cylinder along +Y, scaled to the visible length). */
  readonly stream: THREE.Mesh;
  /** Drops running down the stream. */
  readonly drops: THREE.Mesh[] = [];
  /** The model's bounds (model frame) and its spout tip / axis there. */
  readonly bounds = new THREE.Box3();
  readonly tipM = new THREE.Vector3();
  readonly axisM = new THREE.Vector3();
  /** The model's centre height (the held view centres the model on its holder) and bounding radius (m). */
  readonly centerY: number;
  readonly radius: number;
  /** Fixed train-local targets: the neck mouth, the spout's axis in the pour pose, the spout tip's pour / waiting points. */
  readonly mouth = new THREE.Vector3();
  readonly dir = new THREE.Vector3();
  readonly tipPour = new THREE.Vector3();
  readonly tipWait = new THREE.Vector3();
  /** Orientations: upright facing the platform, the waiting pose, the pour pose. */
  readonly qUpright = new THREE.Quaternion();
  readonly qWait = new THREE.Quaternion();
  readonly qPour = new THREE.Quaternion();
  /** The pour's facing axis (the can's front in the pour pose: the rocking axis). */
  readonly face = new THREE.Vector3();
  /** Running (a pour is under way) and the phase shown last. */
  active = false;
  phase: PourPhase | null = null;
  private readonly startPos = new THREE.Vector3();
  private readonly startQ = new THREE.Quaternion();
  private readonly startTip = new THREE.Vector3();
  private readonly endPos = new THREE.Vector3();
  private readonly endQ = new THREE.Quaternion();
  private readonly endTip = new THREE.Vector3();
  private endRead = false;
  private readonly ph = {phase: 'lift' as PourPhase, k: 0, tp: 0, rem: 0};
  private readonly vTip = new THREE.Vector3();
  private readonly vA = new THREE.Vector3();
  private readonly qA = new THREE.Quaternion();
  /** The stream's end inside the neck, its direction (from the pour tip) and length (m). */
  readonly streamEnd = new THREE.Vector3();
  readonly streamDir = new THREE.Vector3();
  readonly streamLen: number;

  /**
   * `mouth`: the filler neck's outer end (train-local; the neck runs +z into the car). `limits`: the housing plate's front and the
   * skin plane (train-local z) the posed can must stay in front of. `hand`: where the hand holds the can (begin / settle).
   */
  constructor(itemId: string, mouth: V3, limits: {plateZ: number; skinZ: number}, private readonly hand: HandPose) {
    this.root.name = 'fuel-pour';
    this.root.visible = false;
    // the can: the shared item template (the loaded GLB, or the labelled fallback box in Node / after a failed load)
    this.can = makeSupplyMesh(itemId);
    this.can.name = 'fuel-pour-can';
    this.can.updateMatrixWorld(true);
    this.bounds.setFromObject(this.can);
    if (this.bounds.isEmpty()) this.bounds.set(new THREE.Vector3(-0.1, 0, -0.05), new THREE.Vector3(0.1, 0.3, 0.05));
    const b = this.bounds, size = b.getSize(new THREE.Vector3()), S = POUR_VIEW.spoutTip;
    this.tipM.set((b.min.x + b.max.x) / 2 + S[0] * size.x, b.min.y + S[1] * size.y, (b.min.z + b.max.z) / 2 + S[2] * size.z);
    this.axisM.set(...POUR_VIEW.spoutAxis).normalize();
    this.centerY = (b.min.y + b.max.y) / 2;
    this.radius = size.length() / 2;
    this.root.add(this.can);
    // the stream + drops: one shared translucent amber material (FrontSide, single pass), unit geometries scaled per frame
    const mat = new THREE.MeshStandardMaterial({name: 'fuel-pour-stream', color: 0xc48a22, emissive: 0x4a2c06, emissiveIntensity: 0.8, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false});
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0); // base at the origin, up +Y
    this.stream = new THREE.Mesh(cyl, mat);
    this.stream.name = 'fuel-pour-stream';
    this.root.add(this.stream);
    const drop = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < POUR_VIEW.stream.drops; i++) {
      const d = new THREE.Mesh(drop, mat);
      d.name = 'fuel-pour-drop';
      d.scale.setScalar(POUR_VIEW.stream.dropR);
      this.drops.push(d);
      this.root.add(d);
    }
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false; // (a mapped caster would build a shadow program per material instance)
      m.raycast = () => {}; // decorative: never a hit / aim target
    });
    // fixed targets (train-local): the pour pose (POUR_VIEW.faceUp / tipBeyond) from its basis — model +Z -> `face`, model +Y -> `up`
    this.mouth.set(mouth.x, mouth.y, mouth.z);
    const P = POUR_VIEW;
    this.face.set(0, P.faceUp, -1).normalize();
    const down = new THREE.Vector3(0, -1, 0).addScaledVector(this.face, this.face.y).normalize(); // "down" in the can's plane
    const up = new THREE.Vector3(1, 0, 0).multiplyScalar(Math.cos(P.tipBeyond)).addScaledVector(down, Math.sin(P.tipBeyond));
    const side = up.clone().cross(this.face); // model +X
    this.qPour.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, this.face));
    this.dir.copy(this.axisM).applyQuaternion(this.qPour); // the spout's axis in the pour pose (points down over the neck)
    this.qUpright.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // front (+Z) to the platform (-Z)
    this.qWait.copy(this.qUpright).slerp(this.qPour, P.approach.tilt);
    this.tipPour.copy(this.mouth).add(new THREE.Vector3(P.tipAt.x, P.tipAt.y, P.tipAt.z));
    // clearance: in the pour pose every corner of the can's bounds stays in front of the housing plate (the spout's own corners: in
    // front of the skin) — the tip is moved straight out (-z) as far as that needs
    const corner = new THREE.Vector3(), spoutZone = POUR_VIEW.spoutZone * Math.max(size.x, size.y, size.z);
    let out = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const near = corner.distanceTo(this.tipM) < spoutZone;
      const z = this.tipPour.z + corner.sub(this.tipM).applyQuaternion(this.qPour).z, lim = (near ? limits.skinZ : limits.plateZ) - P.clearance;
      out = Math.max(out, z - lim);
    }
    this.tipPour.z -= out;
    this.tipWait.copy(this.tipPour).add(new THREE.Vector3(P.approach.x, P.approach.y, P.approach.z));
    // the stream: spout tip -> a point inside the neck (on its axis)
    this.streamEnd.copy(this.mouth).add(new THREE.Vector3(0, 0, P.stream.inside));
    this.streamDir.subVectors(this.streamEnd, this.tipPour);
    this.streamLen = this.streamDir.length();
    this.streamDir.normalize();
    this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.streamDir);
    this.hideFx();
  }

  /** Start showing a pour: the can appears where the hand holds it. */
  begin(): void {
    if (!this.hand(this.startPos, this.startQ)) { this.startQ.copy(this.qUpright); this.startPos.copy(this.tipWait).add(this.vA.set(0, -0.35, -0.45)); }
    this.startTip.copy(this.tipM).applyQuaternion(this.startQ).add(this.startPos);
    this.endRead = false;
    this.active = true;
    this.root.visible = true;
    this.phase = null;
  }

  /** Stop showing it (completion or cancel): hidden at once. */
  end(): void {
    this.active = false;
    this.phase = null;
    this.root.visible = false;
    this.hideFx();
  }

  /** Pose the can / stream for a pour `t` seconds in (of `total`). */
  update(t: number, total: number): void {
    if (!this.active) return;
    const P = POUR_VIEW, ph = pourPhaseAt(t, total, this.ph), e = ease(ph.k), q = this.qA, tip = this.vTip;
    this.phase = ph.phase;
    if (ph.phase === 'lift') {
      tip.lerpVectors(this.startTip, this.tipWait, e);
      tip.y += P.arc * Math.sin(Math.PI * ph.k);
      q.slerpQuaternions(this.startQ, this.qWait, e);
    } else if (ph.phase === 'tilt') {
      tip.lerpVectors(this.tipWait, this.tipPour, e);
      q.slerpQuaternions(this.qWait, this.qPour, e);
    } else if (ph.phase === 'pour') {
      tip.copy(this.tipPour);
      q.setFromAxisAngle(this.face, P.rock.amp * Math.sin(2 * Math.PI * P.rock.hz * ph.tp)).multiply(this.qPour); // rocks about the pinned spout
    } else {
      if (!this.endRead) { // the hand may have moved during the pour: return to where it is now (read once)
        this.endRead = true;
        if (!this.hand(this.endPos, this.endQ)) { this.endPos.copy(this.startPos); this.endQ.copy(this.startQ); }
        this.endTip.copy(this.tipM).applyQuaternion(this.endQ).add(this.endPos);
      }
      tip.lerpVectors(this.tipPour, this.endTip, e);
      tip.y += 0.5 * P.arc * Math.sin(Math.PI * ph.k);
      q.slerpQuaternions(this.qPour, this.endQ, ease(Math.min(1, ph.k * 1.6))); // righted first, then lowered to the hand
    }
    // the model origin from the spout tip: the tip leads (the spout is guided into line with the neck)
    this.can.quaternion.copy(q);
    this.can.position.copy(this.tipM).applyQuaternion(q).negate().add(tip);
    this.updateFx(ph.phase === 'pour' ? ph.tp : -1, ph.rem, t);
  }

  /** The stream (and its drops) over [a, b] of its length while pouring; hidden otherwise. */
  private updateFx(tp: number, rem: number, t: number): void {
    const S = POUR_VIEW.stream, L = this.streamLen;
    if (tp < 0) { this.hideFx(); return; }
    const a = L * (1 - clamp01(rem / S.growS)), b = L * clamp01(tp / S.growS); // grows from the spout, detaches from it at the end
    if (b - a < 1e-3) { this.hideFx(); return; }
    const wob = 1 + 0.18 * Math.sin(t * 47) * Math.sin(t * 13);
    this.stream.visible = true;
    this.stream.position.copy(this.tipPour).addScaledVector(this.streamDir, a);
    this.stream.scale.set(S.r * wob, b - a, S.r * wob);
    for (let i = 0; i < this.drops.length; i++) {
      const f = (t * S.flowHz + i / this.drops.length) % 1, d = L * f, drop = this.drops[i];
      drop.visible = d >= a && d <= b;
      if (drop.visible) drop.position.copy(this.tipPour).addScaledVector(this.streamDir, d);
    }
  }

  private hideFx(): void {
    this.stream.visible = false;
    for (const d of this.drops) d.visible = false;
  }

  /** The can's spout tip now (train-local) — QA / tests. */
  spoutTip(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.tipM).applyQuaternion(this.can.quaternion).add(this.can.position);
  }

  /** The can's up axis now (train-local) — QA / tests. */
  canUp(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.can.quaternion);
  }

  /** The visible stream's ends (train-local; null while hidden) — QA / tests. */
  streamEnds(): {from: THREE.Vector3; to: THREE.Vector3} | null {
    if (!this.stream.visible) return null;
    const from = this.stream.position.clone();
    return {from, to: from.clone().addScaledVector(this.streamDir, this.stream.scale.y)};
  }

  /** QA: a compact report. */
  qa(): {active: boolean; phase: PourPhase | null; visible: boolean; stream: boolean} {
    return {active: this.active, phase: this.phase, visible: this.root.visible, stream: this.stream.visible};
  }

  /** The can's model origin for its CENTRE at `c` held with orientation `q` (the held view centres the model on its holder). */
  originFromCentre(c: V3, q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, -this.centerY, 0).applyQuaternion(q);
    out.x += c.x; out.y += c.y; out.z += c.z;
    return out;
  }
}
