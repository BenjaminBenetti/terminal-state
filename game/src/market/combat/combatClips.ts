// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market humans' COMBAT clips, authored at RUNTIME per body with the
// pose solver (market/combat/humanRig.ts) on the body's own bind skeleton, and shared by every actor of that body (built once per cast
// file + body + gun). Healthy, upright motion — never the zombie set:
//   Run            panicked flight: a real run cycle (treadmill stance at the ground speed, flight phase, knee lift), pumping arms
//   Cower          hiding: deep crouch, head down, forearms over the head, trembling
//   Hit            a flinch (one-shot); Death: knees buckle, the body falls on its back (terminal; the ragdoll's fallback and the
//                  revisited body's pose)
//   per gun (pistol / rifle / shotgun: the player's own models, held in the right hand):
//   Aim@<gun>      shouldered long gun in a bladed stance / a two-handed pistol (isosceles), breathing sway
//   Fire@<gun>     one round's recoil (one-shot)
//   Reload@<gun>   magazine out to the belt pouch and back in / shells fed one by one (shotgun) / a pistol magazine change
//   Run@<gun>      the run with the gun at the low ready, the support hand on it
//   Hit@<gun>      the flinch, still holding the gun
// The gun sits in the right hand at a fixed GRIP transform (gripFor): calibrated so the Aim pose's straight wrist points the muzzle along
// the body's forward; every other armed pose places the gun explicitly (grip point + orientation) and the hands follow it (IK).
import * as THREE from 'three';
import {HUMAN_JOINTS, HumanRig, eulerQ, sampleClip, type Deg3, type HumanJoint, type HumanPose, type Limb, type Trunk, ZERO3} from './humanRig';
import type {MarketGunId} from './record';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Deg3, b: Deg3, t: number): Deg3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const add3 = (a: Deg3, b: Deg3): Deg3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Piecewise smoothstep through keys [[u, value], ...] (u ascending). */
function keyed<T>(u: number, keys: [number, T][], mix: (a: T, b: T, t: number) => T): T {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) return mix(keys[i - 1][1], keys[i][1], ss(keys[i - 1][0], keys[i][0], u));
  return keys[keys.length - 1][1];
}
const mixV = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);

/** The gun models' markers (model space: muzzle -Z, +Y up; game/public/assets/models pistol.glb, rifle-user.glb, shotgun-user.glb). */
export const GUN_MARKERS: Readonly<Record<MarketGunId, {grip: [number, number, number]; muzzle: [number, number, number]; support: [number, number, number]; butt: number}>> = {
  // support = where the other hand holds it, relative to the Grip marker; butt = the stock's end behind the grip (m)
  pistol: {grip: [0, -0.021, 0.054], muzzle: [0, 0.046, -0.091], support: [-0.032, -0.012, 0.004], butt: 0},
  rifle: {grip: [0, -0.075, 0.17], muzzle: [0, 0.044, -0.439], support: [0, 0.035, -0.25], butt: 0.27},
  shotgun: {grip: [0, 0.03, 0.212], muzzle: [0, 0.087, -0.485], support: [0, -0.01, -0.33], butt: 0.28},
};
/** The wrist relative to the grip, in gun space (behind and below the grip the hand wraps). */
const WRIST_IN_GUN = V(0, -0.045, 0.065);
/** The support wrist relative to its hold point (gun space: the hand comes from the gun's left, under it). */
const SUPPORT_WRIST = V(-0.03, -0.05, 0.055);

/** A gun orientation in the model frame: the muzzle along +Z (forward), then yaw (+ left) / pitch (+ muzzle up) / cant (+ top to the left). */
export function gunRot(yaw = 0, pitch = 0, cant = 0): THREE.Quaternion {
  const D = Math.PI / 180;
  // (gun space: Rx(+) lifts the muzzle (-Z) up, Rz(+) turns its right side (+X) up = the top to the left; Ry(pi) faces it forward)
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, Math.PI + yaw * D, cant * D, 'YXZ'));
}

/** The gun's fixed place in the right hand (hand-bone local; model metres): rotation + the Grip marker's position. */
export interface GunGrip { rot: THREE.Quaternion; pos: THREE.Vector3 }

interface Kit {
  rig: HumanRig;
  B: Record<HumanJoint, THREE.Vector3>;
  hipsY: number;
  legLen: number;
  armLen: number;
}

function kitOf(rig: HumanRig): Kit {
  return {rig, B: rig.bind, hipsY: rig.bind.Hips.y, legLen: rig.reach('L_leg'), armLen: rig.reach('L_arm')};
}

// ---------------------------------------------------------------------------------------------------------------- shared pieces

/** A planted foot: the ankle at its bind height (sole on the floor), shifted (dx, dz), turned `yaw` degrees; the knee toward `out`. */
function plant(k: Kit, side: 'L' | 'R', dx: number, dz: number, yaw = 0, out = 0.12) {
  const a = k.B[`${side}_Foot`];
  return (): Limb => ({kind: 'ik', target: V(a.x + dx, a.y, a.z + dz), pole: V(side === 'L' ? out : -out, 0, 1), end: eulerQ([0, yaw, 0])});
}

/** Run cycle foot (phase 0..1): stance (beta) slides back at the ground speed; flight / swing brings it forward with a high knee. */
function runFoot(ph: number, G: RunGait): {dz: number; lift: number; pitch: number} {
  const p = ((ph % 1) + 1) % 1;
  if (p < G.beta) {
    const s = p / G.beta;
    return {dz: G.center + G.stride / 2 - G.stride * s, lift: 0, pitch: lerp(-6, 0, ss(0, 0.25, s)) + 28 * ss(0.6, 1, s)};
  }
  const s = (p - G.beta) / (1 - G.beta), e = s * s * (3 - 2 * s);
  return {dz: G.center - G.stride / 2 + G.stride * e, lift: G.lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 1.1), pitch: lerp(30, -8, ss(0.1, 0.85, s))};
}

interface RunGait { T: number; beta: number; stride: number; center: number; lift: number; drop: number; bob: number; speed: number }

/** A body's run gait: the stance excursion fits the leg (the IK never over-reaches), ground speed = stride / stance time. */
export function runGait(k: Kit): RunGait {
  const T = 0.68, beta = 0.38, drop = 0.075, bob = 0.03;
  const legH = k.hipsY - k.B.L_Foot.y - drop - bob; // hip above the ankle at the lowest point
  const reach = Math.sqrt(Math.max(0.01, (k.legLen * 0.985) ** 2 - legH * legH));
  const stride = Math.min(0.62, 2 * reach * 0.92);
  return {T, beta, stride, center: 0.03, lift: 0.2, drop, bob, speed: stride / (beta * T)};
}

/** Running legs + pelvis for a cycle phase w (0..1). */
function runLegs(k: Kit, G: RunGait, u: number) {
  const fl = runFoot(u, G), fr = runFoot(u + 0.5, G);
  // the pelvis is lowest at mid-stance of either foot (twice a cycle)
  const ph = 4 * Math.PI * u - Math.PI / 2 - 2 * Math.PI * G.beta;
  const a = k.B.L_Foot, b = k.B.R_Foot;
  return {
    hips: V(0, k.hipsY - G.drop + G.bob * Math.sin(ph), k.B.Hips.z + 0.04),
    hipsYaw: 7 * Math.sin(TAU * u),
    legL: (): Limb => ({kind: 'ik', target: V(a.x - 0.012, a.y + fl.lift, a.z + fl.dz), pole: V(0.08, 0, 1), end: eulerQ([fl.pitch, 0, 0])}),
    legR: (): Limb => ({kind: 'ik', target: V(b.x + 0.012, b.y + fr.lift, b.z + fr.dz), pole: V(-0.08, 0, 1), end: eulerQ([fr.pitch, 0, 0])}),
  };
}

/** The right wrist + hand rotation that put the gun's grip at `grip` with orientation `g` (model frame). */
function gunHand(grip: THREE.Vector3, g: THREE.Quaternion, G: GunGrip, pole: THREE.Vector3): Limb {
  const hand = g.clone().multiply(G.rot.clone().invert());
  return {kind: 'ik', target: grip.clone().sub(G.pos.clone().applyQuaternion(hand)), pole, end: hand};
}

/** The support (left) hand on the gun's hold point. */
function supportHand(gun: MarketGunId, grip: THREE.Vector3, g: THREE.Quaternion, pole: THREE.Vector3): Limb {
  const s = V(...GUN_MARKERS[gun].support).add(SUPPORT_WRIST).applyQuaternion(g);
  return {kind: 'ik', target: grip.clone().add(s), pole};
}

/** Where the gun is in an aimed pose: long guns in the right shoulder pocket, the pistol out in front at eye line. */
function aimGrip(gun: MarketGunId, t: Trunk, g: THREE.Quaternion): THREE.Vector3 {
  const S = t.pos.R_UpperArm, C = t.pos.Chest;
  if (gun === 'pistol') return V(lerp(S.x, C.x, 0.72), S.y + 0.035, S.z + 0.36);
  // the butt pad sits just inside / in front of the shoulder joint, the bore a little under the eye
  const butt = V(...GUN_MARKERS[gun].grip).setZ(GUN_MARKERS[gun].grip[2] + GUN_MARKERS[gun].butt);
  const pocket = V(S.x + 0.045, S.y - 0.015, S.z + 0.03);
  return pocket.sub(butt.sub(V(...GUN_MARKERS[gun].grip)).applyQuaternion(g));
}

/** Aimed-pose trunk per gun (degrees): long guns bladed (the hips / chest turned right, the head back to the line, cheek on the stock). */
function aimTrunk(gun: MarketGunId, breath: number) {
  if (gun === 'pistol') return {hipsRot: [0, -6, 0] as Deg3, spine: [3 + breath, 2, 0] as Deg3, chest: [4 + breath * 0.6, 4, 0] as Deg3, neck: [-2, 0, 0] as Deg3, head: [4, 0, 0] as Deg3};
  return {hipsRot: [0, -24, 0] as Deg3, spine: [4 + breath, -9, 0] as Deg3, chest: [5 + breath * 0.6, -7, 0] as Deg3, neck: [5, 18, -2] as Deg3, head: [11, 21, -6] as Deg3};
}

const ARM_POLE = {
  gunR: V(-0.55, -0.8, -0.25), supportL: V(0.35, -0.9, -0.1), pistolL: V(0.45, -0.85, -0.25), pistolR: V(-0.45, -0.85, -0.25),
};

/** Calibrate the gun's place in the right hand: the Aim pose solved with a straight wrist (see the file header). */
export function gripFor(rig: HumanRig, gun: MarketGunId): GunGrip {
  const k = kitOf(rig), g = gunRot();
  const tr = aimTrunk(gun, 0);
  const pose: HumanPose = {
    hips: V(0, k.hipsY - 0.04, k.B.Hips.z), ...tr,
    armR: t => { const grip = aimGrip(gun, t, g); return {kind: 'ik', target: grip.clone().add(WRIST_IN_GUN.clone().applyQuaternion(g)), pole: gun === 'pistol' ? ARM_POLE.pistolR : ARM_POLE.gunR}; },
    armL: () => ({kind: 'fk', upper: ZERO3, lower: ZERO3}),
    legL: plant(k, 'L', 0.03, 0.12), legR: plant(k, 'R', -0.03, -0.16),
  };
  const s = rig.solve(pose);
  const hand = s.rot.R_Hand, wrist = s.pos.R_Hand;
  // the grip as seen from the wrist the IK reached (were the target out of reach, the gun still sits in the hand)
  const at = wrist.clone().sub(WRIST_IN_GUN.clone().applyQuaternion(g));
  const inv = hand.clone().invert();
  return {rot: inv.clone().multiply(g), pos: at.sub(wrist).applyQuaternion(inv)};
}

// ---------------------------------------------------------------------------------------------------------------- the clips

export const COMBAT_CLIP = {
  run: 'Run', cower: 'Cower', hit: 'Hit', death: 'Death',
  aim: (g: MarketGunId) => `Aim@${g}`, fire: (g: MarketGunId) => `Fire@${g}`, reload: (g: MarketGunId) => `Reload@${g}`,
  runArmed: (g: MarketGunId) => `Run@${g}`, hitArmed: (g: MarketGunId) => `Hit@${g}`,
} as const;
/** One-shots (back to the loop) / terminal (held). */
export const combatOneShots = (g: MarketGunId): string[] => ['Hit', COMBAT_CLIP.fire(g), COMBAT_CLIP.hitArmed(g)];
export const COMBAT_TERMINAL = ['Death'] as const;
export const CLIP_DURATION = {aim: 2.4, fire: 0.26, hit: 0.42, cower: 1.6, death: 1.3, reload: {pistol: 1.8, rifle: 2.6, shotgun: 2.7}} as const;

function unarmedClips(k: Kit, prefix: string): Map<string, THREE.AnimationClip> {
  const rig = k.rig, G = runGait(k), out = new Map<string, THREE.AnimationClip>();
  // --- Run: lean, pumping arms (opposite the legs), elbows ~85 degrees
  out.set(COMBAT_CLIP.run, sampleClip(COMBAT_CLIP.run, G.T, rig, prefix, t => {
    const u = t / G.T, w = TAU * u, L = runLegs(k, G, u), sw = Math.cos(w);
    return {
      hips: L.hips, hipsRot: [9, L.hipsYaw, 0], spine: [5, -L.hipsYaw * 0.6, 0], chest: [4, -L.hipsYaw * 0.9, 0], neck: [-6, 0, 0], head: [-4, 0, 0],
      armL: () => ({kind: 'fk', upper: [32 * sw - 6, 0, -10], lower: [-80 - 14 * Math.max(0, -sw), 0, 0], end: [0, 0, 6]}),
      armR: () => ({kind: 'fk', upper: [-32 * sw - 6, 0, 10], lower: [-80 - 14 * Math.max(0, sw), 0, 0], end: [0, 0, -6]}),
      legL: L.legL, legR: L.legR,
    };
  }));
  // --- Cower: crouched low behind cover, forearms over the head
  out.set(COMBAT_CLIP.cower, sampleClip(COMBAT_CLIP.cower, CLIP_DURATION.cower, rig, prefix, t => {
    const tr = 0.6 * Math.sin(TAU * t * 5) + 0.4 * Math.sin(TAU * t * 3.2 + 1); // trembling
    const drop = k.legLen * 0.42;
    return {
      hips: V(0, k.hipsY - drop, k.B.Hips.z - 0.16), hipsRot: [24, 0, 0], spine: [20 + tr * 0.5, 0, 0], chest: [16, 0, tr * 0.4], neck: [18, 0, 0], head: [16, 0, 0],
      armL: t2 => ({kind: 'ik', target: t2.pos.Head.clone().add(V(0.12, 0.05, 0.06 + tr * 0.004)), pole: V(0.6, -0.3, 0.75)}),
      armR: t2 => ({kind: 'ik', target: t2.pos.Head.clone().add(V(-0.12, 0.05, 0.06 - tr * 0.004)), pole: V(-0.6, -0.3, 0.75)}),
      legL: plant(k, 'L', 0.04, 0.06, 8, 0.35), legR: plant(k, 'R', -0.04, 0.0, -8, 0.35),
    };
  }));
  // --- Hit (unarmed flinch: the torso jolts back, the arms come up)
  out.set(COMBAT_CLIP.hit, sampleClip(COMBAT_CLIP.hit, CLIP_DURATION.hit, rig, prefix, t => {
    const e = ss(0, 0.07, t) * (1 - ss(0.1, CLIP_DURATION.hit, t));
    return {
      hips: V(0, k.hipsY - 0.01 - 0.03 * e, k.B.Hips.z - 0.03 * e), hipsRot: [-4 * e, 0, 0], spine: [1 - 8 * e, 0, 0], chest: [1 - 9 * e, 0, 3 * e], neck: [2 - 6 * e, 0, 0], head: [-2 - 12 * e, 0, -6 * e],
      armL: () => ({kind: 'fk', upper: [-30 * e, 0, -4], lower: [-12 - 50 * e, 0, 0]}),
      armR: () => ({kind: 'fk', upper: [-26 * e, 0, 4], lower: [-12 - 46 * e, 0, 0]}),
      legL: plant(k, 'L', 0, 0), legR: plant(k, 'R', 0, 0),
    };
  }));
  // --- Death: knees buckle, the body tips back and lies on its back (FK throughout: the feet leave the floor as it falls)
  out.set(COMBAT_CLIP.death, sampleClip(COMBAT_CLIP.death, CLIP_DURATION.death, rig, prefix, t => {
    const u = t / CLIP_DURATION.death;
    const hips = keyed(u, [[0, V(0, k.hipsY - 0.01, k.B.Hips.z)], [0.28, V(0, k.hipsY * 0.68, k.B.Hips.z - 0.05)], [0.72, V(0, 0.13, k.B.Hips.z - 0.36)], [0.84, V(0, 0.15, k.B.Hips.z - 0.37)], [1, V(0, 0.125, k.B.Hips.z - 0.37)]], mixV);
    const hipsRot = keyed<Deg3>(u, [[0, [0, 0, 0]], [0.28, [6, 0, 2]], [0.72, [-90, 0, 4]], [0.84, [-86, 0, 4]], [1, [-90, 0, 4]]], lerp3);
    const spine = keyed<Deg3>(u, [[0, [1, 0, 0]], [0.28, [16, 0, 0]], [0.72, [-4, 0, 0]], [1, [0, 0, 0]]], lerp3);
    const chest = keyed<Deg3>(u, [[0, [1, 0, 0]], [0.28, [12, 0, 0]], [0.72, [-6, 0, 0]], [1, [-2, 0, 0]]], lerp3);
    const head = keyed<Deg3>(u, [[0, [-2, 0, 0]], [0.28, [22, 0, 0]], [0.72, [-14, 10, 18]], [1, [-10, 18, 26]]], lerp3);
    const thigh = keyed<Deg3>(u, [[0, [0, 0, 0]], [0.28, [-38, 0, 0]], [0.72, [-14, 0, 0]], [1, [-6, 0, 0]]], lerp3);
    const shin = keyed<Deg3>(u, [[0, [0, 0, 0]], [0.28, [62, 0, 0]], [0.72, [24, 0, 0]], [1, [14, 0, 0]]], lerp3);
    // the arms come up a little as it buckles, then fall out to the sides onto the floor (+ pitch = toward the back = the floor)
    const upper = keyed<Deg3>(u, [[0, [0, 0, 0]], [0.28, [-20, 0, 12]], [0.72, [6, 0, 36]], [1, [10, 0, 42]]], lerp3);
    const lower = keyed<Deg3>(u, [[0, [-10, 0, 0]], [0.28, [-40, 0, 0]], [0.72, [-22, 0, 0]], [1, [-18, 0, 0]]], lerp3);
    return {
      hips, hipsRot, spine, chest, neck: [0, 0, 0], head,
      armL: () => ({kind: 'fk', upper, lower}), armR: () => ({kind: 'fk', upper: [upper[0], 0, -upper[2]], lower}),
      legL: () => ({kind: 'fk', upper: add3(thigh, [0, 4, 3]), lower: shin, end: [-20 * u, 0, 0]}),
      legR: () => ({kind: 'fk', upper: add3(thigh, [-4 * u, -4, -3]), lower: add3(shin, [-8 * u, 0, 0]), end: [-24 * u, 0, 0]}),
    };
  }));
  return out;
}

function gunClips(k: Kit, prefix: string, gun: MarketGunId, grip: GunGrip): Map<string, THREE.AnimationClip> {
  const rig = k.rig, out = new Map<string, THREE.AnimationClip>(), pistol = gun === 'pistol';
  const poleR = pistol ? ARM_POLE.pistolR : ARM_POLE.gunR, poleL = pistol ? ARM_POLE.pistolL : ARM_POLE.supportL;
  const legL = plant(k, 'L', pistol ? 0.04 : 0.05, pistol ? 0.05 : 0.13, pistol ? 6 : -10), legR = plant(k, 'R', pistol ? -0.04 : -0.04, pistol ? -0.07 : -0.17, pistol ? -6 : -28);
  /** An aimed pose: `kick` 0..1 = a round's recoil (muzzle up, shoulders back), `flinch` 0..1 = a hit. */
  const aimed = (breath: number, kick: number, flinch: number): HumanPose => {
    const tr = aimTrunk(gun, breath);
    const g = gunRot(0, kick * (pistol ? 11 : 6) + flinch * 9, 0);
    const back = kick * (pistol ? 0.02 : 0.035) + flinch * 0.03;
    return {
      hips: V(0, k.hipsY - 0.04 - 0.02 * flinch, k.B.Hips.z - 0.03 * flinch),
      hipsRot: tr.hipsRot, spine: add3(tr.spine, [-4 * flinch, 0, 0]), chest: add3(tr.chest, [-kick * 2.5 - 8 * flinch, 0, 2 * flinch]), neck: tr.neck, head: add3(tr.head, [-kick * 2 - 10 * flinch, 0, 0]),
      armR: t => { const p = aimGrip(gun, t, g).add(V(0, kick * 0.015, -back)); return gunHand(p, g, grip, poleR); },
      armL: t => supportHand(gun, aimGrip(gun, t, g).add(V(0, kick * 0.015, -back)), g, poleL),
      legL, legR,
    };
  };
  out.set(COMBAT_CLIP.aim(gun), sampleClip(COMBAT_CLIP.aim(gun), CLIP_DURATION.aim, rig, prefix, t => aimed(0.7 * Math.sin(TAU * t / CLIP_DURATION.aim), 0, 0)));
  out.set(COMBAT_CLIP.fire(gun), sampleClip(COMBAT_CLIP.fire(gun), CLIP_DURATION.fire, rig, prefix, t => aimed(0, ss(0, 0.035, t) * (1 - ss(0.05, CLIP_DURATION.fire, t)), 0)));
  out.set(COMBAT_CLIP.hitArmed(gun), sampleClip(COMBAT_CLIP.hitArmed(gun), CLIP_DURATION.hit, rig, prefix, t => aimed(0, 0, ss(0, 0.07, t) * (1 - ss(0.1, CLIP_DURATION.hit, t)))));
  // --- Reload: the gun comes down and in; the support hand fetches a magazine from the belt pouch (shells: feeds three)
  const T = CLIP_DURATION.reload[gun];
  out.set(COMBAT_CLIP.reload(gun), sampleClip(COMBAT_CLIP.reload(gun), T, rig, prefix, t => {
    const u = t / T, inOut = ss(0, 0.12, u) * (1 - ss(0.86, 1, u));
    const g = pistol ? gunRot(0, 28 * inOut, -8 * inOut) : gunRot(14 * inOut, -14 * inOut, 28 * inOut);
    const pouch = V(k.B.L_Thigh.x + 0.1, k.hipsY + 0.06, k.B.Hips.z + 0.08);
    return {
      hips: V(0, k.hipsY - 0.035, k.B.Hips.z), ...(() => { const tr = aimTrunk(gun, 0); return {hipsRot: tr.hipsRot, spine: tr.spine, chest: add3(tr.chest, [6 * inOut, 0, 0]), neck: add3(tr.neck, [8 * inOut, pistol ? 0 : -10 * inOut, 0]), head: add3(tr.head, [16 * inOut, pistol ? 0 : -8 * inOut, 0])}; })(),
      armR: tr => {
        const aimP = aimGrip(gun, tr, gunRot());
        const low = pistol ? V(lerp(tr.pos.R_UpperArm.x, tr.pos.Chest.x, 0.8), tr.pos.R_UpperArm.y - 0.14, tr.pos.R_UpperArm.z + 0.26) : V(tr.pos.R_UpperArm.x + 0.1, tr.pos.R_UpperArm.y - 0.17, tr.pos.R_UpperArm.z + 0.2);
        return gunHand(aimP.lerp(low, inOut), g, grip, poleR);
      },
      armL: tr => {
        const aimP = aimGrip(gun, tr, gunRot());
        const low = pistol ? V(lerp(tr.pos.R_UpperArm.x, tr.pos.Chest.x, 0.8), tr.pos.R_UpperArm.y - 0.14, tr.pos.R_UpperArm.z + 0.26) : V(tr.pos.R_UpperArm.x + 0.1, tr.pos.R_UpperArm.y - 0.17, tr.pos.R_UpperArm.z + 0.2);
        const gp = aimP.lerp(low, inOut);
        const hold = gp.clone().add(V(...GUN_MARKERS[gun].support).add(SUPPORT_WRIST).applyQuaternion(g));
        const well = gp.clone().add(V(-0.02, pistol ? -0.14 : -0.12, pistol ? 0.03 : -0.07).applyQuaternion(g));
        const keys: [number, THREE.Vector3][] = gun === 'shotgun'
          ? [[0, hold], [0.12, hold], [0.2, pouch], [0.3, well], [0.4, pouch], [0.5, well], [0.6, pouch], [0.7, well], [0.84, hold], [1, hold]]
          : [[0, hold], [0.12, hold], [0.22, well], [0.36, pouch], [0.46, pouch], [0.62, well], [0.7, well.clone().add(V(0, 0.02, 0))], [0.84, hold], [1, hold]];
        return {kind: 'ik', target: keyed(u, keys, mixV), pole: V(0.5, -0.8, -0.2)};
      },
      legL, legR,
    };
  }));
  // --- Run with the gun at the low ready (support hand on it)
  const G = runGait(k);
  out.set(COMBAT_CLIP.runArmed(gun), sampleClip(COMBAT_CLIP.runArmed(gun), G.T, rig, prefix, t => {
    const u = t / G.T, L = runLegs(k, G, u), bounce = Math.sin(4 * Math.PI * u);
    const g = pistol ? gunRot(6, -32 + 3 * bounce, 0) : gunRot(26, -32 + 3 * bounce, 10);
    const at = (tr: Trunk) => (pistol ? V(lerp(tr.pos.R_UpperArm.x, tr.pos.Chest.x, 0.7), tr.pos.R_UpperArm.y - 0.17, tr.pos.R_UpperArm.z + 0.22) : V(tr.pos.R_UpperArm.x + 0.06, tr.pos.R_UpperArm.y - 0.22, tr.pos.R_UpperArm.z + 0.17));
    return {
      hips: L.hips, hipsRot: [10, L.hipsYaw * 0.7, 0], spine: [5, -L.hipsYaw * 0.4, 0], chest: [4, -L.hipsYaw * 0.6, 0], neck: [-7, 0, 0], head: [-4, 0, 0],
      armR: tr => gunHand(at(tr), g, grip, poleR), armL: tr => supportHand(gun, at(tr), g, poleL),
      legL: L.legL, legR: L.legR,
    };
  }));
  return out;
}

export interface CombatClipSet {
  clips: Map<string, THREE.AnimationClip>;
  grip: GunGrip;
  /** Run ground speed at playback rate 1 (m/s, model scale 1). */
  runSpeed: number;
}

const cache = new WeakMap<object, Map<string, CombatClipSet>>();

/**
 * The combat clips of a body for one gun (cached per cast file `owner` + body + gun): the unarmed set + that gun's set, and the gun's grip
 * in the right hand. `rig` = the body's bind skeleton (rigFromSkeleton).
 */
export function combatClips(owner: object, body: string, prefix: string, gun: MarketGunId, rig: HumanRig): CombatClipSet {
  let m = cache.get(owner);
  if (!m) cache.set(owner, (m = new Map()));
  const key = `${body}|${gun}`;
  let s = m.get(key);
  if (s) return s;
  const k = kitOf(rig);
  let base = m.get(`${body}|`);
  if (!base) { base = {clips: unarmedClips(k, prefix), grip: {rot: new THREE.Quaternion(), pos: new THREE.Vector3()}, runSpeed: runGait(k).speed}; m.set(`${body}|`, base); }
  const grip = gripFor(rig, gun);
  s = {clips: new Map([...base.clips, ...gunClips(k, prefix, gun, grip)]), grip, runSpeed: base.runSpeed};
  m.set(key, s);
  return s;
}

/** A body's bind rig from its skinned body's skeleton (bind matrices: robust to any clip already applied to the bones). */
export function rigFromSkeleton(skeleton: THREE.Skeleton, prefix: string): HumanRig {
  const world = new Map<string, THREE.Vector3>();
  skeleton.bones.forEach((b, i) => world.set(b.name, new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[i].clone().invert())));
  const local = {} as Record<HumanJoint, THREE.Vector3>;
  for (const j of HUMAN_JOINTS) {
    const w = world.get(prefix + j);
    if (!w) throw new Error(`human rig: no bone ${prefix}${j}`);
    const parent = j === 'Root' ? null : (({Hips: 'Root', Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck', L_UpperArm: 'Chest', L_Forearm: 'L_UpperArm', L_Hand: 'L_Forearm', R_UpperArm: 'Chest', R_Forearm: 'R_UpperArm', R_Hand: 'R_Forearm', L_Thigh: 'Hips', L_Shin: 'L_Thigh', L_Foot: 'L_Shin', R_Thigh: 'Hips', R_Shin: 'R_Thigh', R_Foot: 'R_Shin'}) as Record<string, string>)[j];
    local[j] = parent ? w.clone().sub(world.get(prefix + parent)!) : w.clone();
  }
  return new HumanRig(local);
}
