// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): THE BAR PATRONS' DRINKING — loops authored at RUNTIME per body with the pose
// solver (market/combat/humanRig.ts) like the combat clips (market/combat/combatClips.ts), shared by every actor of that body. User: "NPCs
// drinking" at the bar.
//   Drink / Drink2           standing at a counter, a bottle in the right hand: holding it at the chest, raising it, a sip (the head back,
//                            the bottle tipped to the lips), lowering it; Drink2 is a slower variant with two sips, a look round and the
//                            other forearm resting forward (on the counter)
//   DrinkSit@<cm> / 2        the same on a seat <cm> high (a bar stool, a table's chair): the hips on the seat, knees forward, feet down to
//                            the floor (or a stool's footrest)
// The bottle sits in the right fist at a fixed GRIP (bottleGrip: its axis along the thumb, the fist round its lower body), placed explicitly
// in every pose (grip point + orientation) and the hand follows it (IK) — the combat clips' gun method. Loops; the patrons are staggered by
// variant and a random start phase (market/marketPeople.ts).
import * as THREE from 'three';
import {HumanRig, eulerQ, sampleClip, type Deg3, type HumanPose, type Limb, type Trunk} from '../combat/humanRig';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Tuning (model metres / degrees). */
export const DRINK = {
  /** Loop lengths (s): the quick variant, the slow one. */
  T: [9, 13] as const,
  /** Sampling rate of these slow loops (keys / s). */
  fps: 15,
  /** The fist round the bottle: grip point from the wrist along the hand / toward the palm. */
  gripAlong: 0.1, gripPalm: 0.045,
  /** The hip joint above a seat's top (seated). */
  hipOverSeat: 0.11,
  /** The lips relative to the head joint (head frame): its height; forward = the body mesh's face there + `lips` (lipsForward), else z. */
  mouth: [0, 0.05, 0.115] as const, lips: 0.008,
  /** Bottle pitch (deg; - = the top toward the face) held / at a sip / at a big swig. */
  holdPitch: 4, sipPitch: -78, swigPitch: -96,
} as const;

/** A bottle in the hand: its height (m) and where the fist holds it (m above its base). */
export interface BottleSpec { h: number; grip: number }
/** The bottle's place in the right hand (hand-bone local; the bottle frame: base-centre origin, +Y up): rotation + the grip point. */
export interface HandGrip { rot: THREE.Quaternion; pos: THREE.Vector3 }

/**
 * The bottle's fixed place in the right fist. The rig's bind rotations are identity, so hand-local = the model frame at bind: the hand's
 * long axis d = the forearm's bind direction, the thumb t = forward (+Z) off d, the palm normal n = t x d (toward the body). The bottle's
 * +Y runs along the thumb, its +Z along the knuckles, its +X out of the palm; its grip point sits `gripAlong` down the hand, `gripPalm`
 * into the fist.
 */
export function bottleGrip(rig: HumanRig): HandGrip {
  const d = rig.bindLocal.R_Hand.clone().normalize();
  const t = V(0, 0, 1).addScaledVector(d, -d.z).normalize();
  const n = new THREE.Vector3().crossVectors(t, d).normalize();
  const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(n, t, d));
  return {rot, pos: d.clone().multiplyScalar(DRINK.gripAlong).addScaledVector(n, DRINK.gripPalm)};
}

/** The right wrist + hand rotation that put the bottle's grip at `grip` with orientation `g` (model frame). */
function bottleHand(grip: THREE.Vector3, g: THREE.Quaternion, G: HandGrip, pole: THREE.Vector3): Limb {
  const hand = g.clone().multiply(G.rot.clone().invert());
  return {kind: 'ik', target: grip.clone().sub(G.pos.clone().applyQuaternion(hand)), pole, end: hand};
}

/** The lips relative to the head joint (head frame) of a body: DRINK.mouth's height, `forward` in front of the joint. */
export const mouthOffset = (forward: number = DRINK.mouth[2]): THREE.Vector3 => V(DRINK.mouth[0], DRINK.mouth[1], forward);

/** The lips' model-frame point of a posed trunk. */
export function mouthOf(t: Trunk, offset = mouthOffset()): THREE.Vector3 {
  return t.pos.Head.clone().add(offset.clone().applyQuaternion(t.rot.Head));
}

/**
 * How far in front of the head joint a body's lips are: its bind mesh's frontmost vertex near the midline at mouth height (+ `lips`),
 * else DRINK.mouth's default. (`mesh` = the body's SkinnedMesh: its geometry is in the bind frame.)
 */
export function lipsForward(mesh: THREE.SkinnedMesh, rig: HumanRig): number {
  const P = mesh.geometry.attributes.position, y0 = rig.bind.Head.y + DRINK.mouth[1];
  let z = -Infinity;
  for (let i = 0; i < P.count; i++) if (Math.abs(P.getY(i) - y0) < 0.03 && Math.abs(P.getX(i)) < 0.03 && P.getZ(i) > z) z = P.getZ(i);
  return Number.isFinite(z) && z - rig.bind.Head.z > 0.04 && z - rig.bind.Head.z < 0.2 ? +(z - rig.bind.Head.z + DRINK.lips).toFixed(3) : DRINK.mouth[2];
}

interface Kit { rig: HumanRig; B: Record<string, THREE.Vector3>; hipsY: number; armIn: number; thigh: number; shin: number }
function kitOf(rig: HumanRig): Kit {
  const ua = rig.bindLocal.L_Forearm, abd = Math.atan2(Math.abs(ua.x), -ua.y) * 180 / Math.PI;
  return {rig, B: rig.bind, hipsY: rig.bind.Hips.y, armIn: Math.max(0, abd - 6), thigh: rig.len.L_leg[0], shin: rig.len.L_leg[1]};
}

/** A planted standing foot (the ankle at its bind height), shifted, turned `yaw` degrees. */
function plant(k: Kit, side: 'L' | 'R', dx: number, dz: number, yaw = 0) {
  const a = k.B[`${side}_Foot`];
  return (): Limb => ({kind: 'ik', target: V(a.x + dx, a.y, a.z + dz), pole: V(side === 'L' ? 0.12 : -0.12, 0, 1), end: eulerQ([0, yaw, 0])});
}

/** A seated leg: knee forward at about the seat, the shin down to the floor (a stool too high: the foot on its rail, the knee bent). */
function seatedLeg(k: Kit, side: 'L' | 'R', hips: THREE.Vector3, splay: number) {
  const a = k.B[`${side}_Foot`], x = a.x + (side === 'L' ? splay : -splay);
  const kneeZ = hips.z + k.thigh * 0.94, kneeY = hips.y - 0.05;
  const footY = Math.max(a.y, kneeY - k.shin * 0.97);
  const footZ = kneeZ + (footY > a.y + 0.05 ? -0.06 : 0.05); // (on a footrest the shin tucks back a little)
  return (): Limb => ({kind: 'ik', target: V(x, footY, footZ), pole: V(side === 'L' ? 0.1 : -0.1, 0.5, 1), end: eulerQ([footY > a.y + 0.05 ? 18 : 0, side === 'L' ? 6 : -6, 0])});
}

/** Sip timelines (u in 0..1 -> 0 = held, 1 = at the lips) of the two variants. */
const SIPS: readonly (readonly [number, number, number, number][])[] = [
  [[0.5, 0.62, 0.76, 0.88]],
  [[0.17, 0.27, 0.36, 0.46], [0.69, 0.78, 0.9, 0.98]],
].map(v => v.map(s => [...s] as [number, number, number, number]));
function sipAt(variant: 0 | 1, u: number): {s: number; swig: number} {
  let s = 0, swig = 0;
  SIPS[variant].forEach(([a, b, c, d], i) => {
    const v = ss(a, b, u) * (1 - ss(c, d, u));
    if (v > s) { s = v; swig = variant === 1 && i === 1 ? ss(b, (b + c) / 2, u) * (1 - ss((b + c) / 2, c, u)) : 0; }
  });
  return {s, swig};
}

/** A drinking pose: `variant` 0 / 1 at loop phase u; `seat` = the seat height in model metres (null: standing). */
function drinkPose(k: Kit, G: HandGrip, bottle: BottleSpec, variant: 0 | 1, u: number, seat: number | null, lips: THREE.Vector3): HumanPose {
  const {s, swig} = sipAt(variant, u);
  const w = TAU * u, breath = Math.sin(w * (variant ? 4 : 3));
  // a look round between the sips (variant 1), the head back for a sip
  const look = variant === 1 ? 16 * Math.sin(TAU * u * 2) * (1 - s) : 4 * Math.sin(w) * (1 - s);
  const sitting = seat !== null;
  const hips = sitting ? V(0, seat + DRINK.hipOverSeat, k.B.Hips.z - 0.05) : V(0.012 * Math.sin(w), k.hipsY - 0.02, k.B.Hips.z);
  const lean = sitting ? 9 : 2;
  const pose: HumanPose = {
    hips, hipsRot: sitting ? [-4, 0, 0] : [0, 3 * Math.sin(w), 1.2 * Math.sin(w)],
    spine: [lean + breath * 0.6 - 3 * s, 0, 0], chest: [lean * 0.6 + breath * 0.4 - 4 * s, look * 0.2, 0],
    neck: [-5 * s + 2, look * 0.35, 0], head: [-16 * s - 6 * swig + 3, look * 0.45, 0],
    armR: t => {
      // held at the chest, in front and in toward the middle; the sip puts the bottle's top at the lips, tipped toward the face, along an
      // arc in front of the chin
      const S = t.pos.R_UpperArm;
      const hold = V(S.x + 0.09, S.y - 0.31 + (sitting ? 0.02 : 0), S.z + 0.27 + 0.01 * breath);
      const gHold = eulerQ([DRINK.holdPitch, 8, 0]);
      const gSip = eulerQ([DRINK.sipPitch + (DRINK.swigPitch - DRINK.sipPitch) * swig - 4 * Math.sin(TAU * u * 6) * s, 0, 0]);
      const g = gHold.clone().slerp(gSip, s);
      const atLips = mouthOf(t, lips).sub(V(0, bottle.h - bottle.grip, 0).applyQuaternion(gSip));
      const grip = hold.clone().lerp(atLips, s).add(V(0, 0, 0.07 * Math.sin(Math.PI * s)));
      return bottleHand(grip, g, G, V(-0.65, -0.75, -0.1));
    },
    armL: variant === 1
      ? () => ({kind: 'fk', upper: [-28, 0, -k.armIn + 6] as Deg3, lower: [-72, 0, 0] as Deg3, end: [0, 0, 8] as Deg3}) // the forearm forward, on the counter
      : sitting
        ? (t: Trunk): Limb => ({kind: 'ik', target: t.pos.L_Thigh.clone().add(V(0.03, 0.07, k.thigh * 0.5)), pole: V(0.5, -0.5, -0.4)}) // the hand on the thigh
        : () => ({kind: 'fk', upper: [3 * Math.sin(w), 0, -k.armIn + 1] as Deg3, lower: [-10, 0, 0] as Deg3, end: [0, 0, 6] as Deg3}),
    legL: sitting ? seatedLeg(k, 'L', hips, 0.03) : plant(k, 'L', 0.05, 0.07, 7),
    legR: sitting ? seatedLeg(k, 'R', hips, 0.05) : plant(k, 'R', -0.05, -0.05, -9),
  };
  return pose;
}

export const DRINK_CLIP = {
  stand: (variant: 0 | 1) => (variant ? 'Drink2' : 'Drink'),
  sit: (variant: 0 | 1, seatCm: number) => `${variant ? 'DrinkSit2' : 'DrinkSit'}@${seatCm}`,
} as const;

/** A seat height (world m) -> its clip bucket (cm, 2 cm steps). */
export const seatBucket = (seatY: number): number => Math.round(seatY * 50) * 2;

export interface DrinkClipSet { clips: Map<string, THREE.AnimationClip>; grip: HandGrip }
const cache = new WeakMap<object, Map<string, DrinkClipSet>>();

/**
 * The drinking loops of a body (cached per cast file `owner` + body + bottle + seat): both variants, standing (`seatCm` null) or seated
 * on a seat that high (cm), with the bottle's grip in the right hand.
 */
export function drinkClips(owner: object, body: string, prefix: string, rig: HumanRig, bottle: BottleSpec, seatCm: number | null, lips: number = DRINK.mouth[2]): DrinkClipSet {
  let m = cache.get(owner);
  if (!m) cache.set(owner, (m = new Map()));
  const key = `${body}|${bottle.h.toFixed(3)}|${bottle.grip.toFixed(3)}|${seatCm ?? '-'}|${lips.toFixed(3)}`;
  let s = m.get(key);
  if (s) return s;
  const k = kitOf(rig), G = bottleGrip(rig), mo = mouthOffset(lips);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const v of [0, 1] as const) {
    const name = seatCm === null ? DRINK_CLIP.stand(v) : DRINK_CLIP.sit(v, seatCm);
    const seat = seatCm === null ? null : seatCm / 100;
    clips.set(name, sampleClip(name, DRINK.T[v], rig, prefix, t => drinkPose(k, G, bottle, v, t / DRINK.T[v], seat, mo), DRINK.fps));
  }
  s = {clips, grip: G};
  m.set(key, s);
  return s;
}

/** The sip amount (0 held .. 1 at the lips) of a variant at loop phase u (tests / QA). */
export const drinkSipAt = (variant: 0 | 1, u: number): number => sipAt(variant, u).s;
