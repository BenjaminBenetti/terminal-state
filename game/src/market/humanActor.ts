// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): one rendered human — an assembled appearance
// (market/humanWardrobe.ts) driven by an AnimationMixer over the body's HEALTHY clips with crossfades. No damage / wound materials
// (the materials are shared). Never a zombie: it never joins game.zombies and has no brain.
// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market's combat (market/combat) adds runtime-authored clips to an
// actor (addClips: aim / fire / reload / run / cower / hit / death), reads its bones (bone), corrects the pose after each mixer step
// (postPose: the aim's pitch) and, for a ragdoll, stops the mixer keeping the pose (freezePose). Hit volumes and the ragdoll adapter
// live in market/combat/body.ts, not here.

import * as THREE from 'three';
import {HUMAN_ONE_SHOTS, type HumanClip, type HumanLook} from './humanLooks';
import type {HumanAppearance} from './humanWardrobe';

/** Cull sphere of every pose (standing, walking, the wave, sitting with the legs out): centre 0.8 m up, radius 1.3 m (model metres). */
const CULL = {y: 0.8, r: 1.3};

export class HumanActor {
  readonly root: THREE.Object3D;
  readonly look: HumanLook;
  readonly scale: number;
  readonly meshes: THREE.SkinnedMesh[];
  /** Walk ground speed at playback rate 1 for this actor's scale (m/s). */
  readonly walkSpeed: number;
  readonly heightM: number;
  /** Joint name prefix of this body ('<body>_'). */
  readonly prefix: string;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  /** One-shot clips (played once, then back to the loop) and terminal ones (held at the last frame: a death). */
  private readonly oneShots = new Set<string>(HUMAN_ONE_SHOTS);
  private readonly terminal = new Set<string>();
  /** Ground speed (m/s at playback rate 1, model scale 1) of the locomotion loops; their playback rate follows the actual speed. */
  private readonly groundSpeed = new Map<string, number>();
  /** The loop currently shown (a one-shot returns to it). */
  loop: string = 'Idle';
  private oneShot: string | null = null;
  current: string | null = null;
  /** World pose (feet): written by the owner, applied by sync(). */
  x = 0; y = 0; z = 0; yaw = 0;
  /** Animation time not yet applied (far actors update every few frames). */
  private pendingDt = 0;
  /** Called right after every mixer step (pose corrections on top of the clip). */
  postPose: (() => void) | null = null;
  /** The mixer is stopped and the bones belong to someone else (a ragdoll): no animation, no root sync. */
  frozen = false;
  private readonly bones = new Map<string, THREE.Object3D | undefined>();
  private readonly finished = (e: {action: THREE.AnimationAction}) => {
    if (this.oneShot && e.action === this.actions.get(this.oneShot) && !this.terminal.has(this.oneShot)) { this.oneShot = null; this.play(this.loop, 0.35); }
  };

  constructor(app: HumanAppearance, phase = 0) {
    this.root = app.root;
    this.look = app.look;
    this.scale = app.look.scale;
    this.meshes = app.meshes;
    this.prefix = app.prefix;
    this.walkSpeed = app.walkSpeed * this.scale;
    this.heightM = app.heightM * this.scale;
    this.groundSpeed.set('Walk', app.walkSpeed);
    this.root.scale.setScalar(this.scale);
    for (const m of this.meshes) m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, CULL.y, 0), CULL.r);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [name, clip] of app.clips) this.addAction(name, clip);
    this.mixer.addEventListener('finished', this.finished as never);
    this.play('Idle', 0);
    // desync the loops of people standing side by side
    const idle = this.actions.get('Idle');
    if (idle) idle.time = phase * idle.getClip().duration;
  }

  private addAction(name: string, clip: THREE.AnimationClip): void {
    const a = this.mixer.clipAction(clip);
    // (clamped: the last frame holds while the loop fades back in, never a blend from the bind pose)
    if (this.oneShots.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    this.actions.set(name, a);
  }

  /**
   * Task studio-market-rework-20261108-074144-01 (lane COMBAT): more clips for this actor (shared AnimationClip objects of its body).
   * `oneShots` play once then return to the loop, `terminal` ones hold their last frame; `ground` = locomotion loops' ground speeds.
   */
  addClips(clips: ReadonlyMap<string, THREE.AnimationClip>, o: {oneShots?: readonly string[]; terminal?: readonly string[]; ground?: Readonly<Record<string, number>>} = {}): void {
    for (const n of o.oneShots ?? []) this.oneShots.add(n);
    for (const n of o.terminal ?? []) { this.oneShots.add(n); this.terminal.add(n); }
    for (const [n, v] of Object.entries(o.ground ?? {})) this.groundSpeed.set(n, v);
    for (const [name, clip] of clips) if (!this.actions.has(name)) this.addAction(name, clip);
  }

  has(name: HumanClip | string): boolean { return this.actions.has(name); }

  /** Crossfade to a clip (a one-shot plays once, then the current loop resumes; a terminal one holds). */
  play(name: HumanClip | string, fade = 0.3): void {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.oneShot && this.terminal.has(this.oneShot)) return; // (dead: nothing plays over the fall)
    const shot = this.oneShots.has(name);
    if (shot) this.oneShot = name;
    else { this.loop = name; if (this.oneShot) return; }
    if (this.current === name && !shot) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): end a running one-shot now and fade back to the loop. */
  cancelOneShot(fade = 0.2): void {
    if (!this.oneShot || this.terminal.has(this.oneShot)) return;
    this.oneShot = null;
    const l = this.loop;
    this.current = null;
    this.play(l, fade);
  }

  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): the playback rate of the current clip (a reload matched to its time). */
  setRate(rate: number): void {
    const a = this.current ? this.actions.get(this.current) : null;
    if (a) a.setEffectiveTimeScale(rate);
  }

  /** Clip duration (s), 0 when absent. */
  duration(name: string): number { return this.actions.get(name)?.getClip().duration ?? 0; }

  /** Playing a one-shot (the greeting). */
  get busy(): boolean { return this.oneShot !== null; }

  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): a joint of this body by its unprefixed name ('Hips', 'R_Hand' ...). */
  bone(name: string): THREE.Object3D | undefined {
    if (!this.bones.has(name)) this.bones.set(name, this.root.getObjectByName(this.prefix + name));
    return this.bones.get(name);
  }

  /**
   * Advance the animation. `speed` = ground speed while walking / running (the playback rate follows it); `stride` > 1 applies the
   * accumulated time only every `stride`-th call (distant people: bounded per-frame cost).
   */
  animate(dt: number, speed = 0, stride = 1, tick = 0): void {
    if (this.frozen) return;
    this.pendingDt += dt;
    if (stride > 1 && tick % stride !== 0) return;
    const g = this.current ? this.groundSpeed.get(this.current) : undefined;
    const a = g ? this.actions.get(this.current!) : null;
    if (a && g) a.setEffectiveTimeScale(Math.max(0.5, Math.min(1.6, speed / Math.max(0.1, g * this.scale))) || 1);
    this.mixer.update(this.pendingDt);
    this.pendingDt = 0;
    this.postPose?.();
  }

  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): stop the mixer WITHOUT restoring the bind pose (a ragdoll takes the bones). */
  freezePose(): void {
    if (this.frozen) return;
    const list: THREE.Object3D[] = [];
    this.root.traverse(o => { if ((o as THREE.Bone).isBone) list.push(o); });
    const saved = list.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    this.mixer.stopAllAction();
    list.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
    this.current = null;
    this.frozen = true;
  }

  sync(): void {
    if (this.frozen) return; // (a ragdoll's root stays where it died; the bodies move the bones)
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
  }

  dispose(): void {
    this.mixer.removeEventListener('finished', this.finished as never);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.dispose(); });
    this.root.removeFromParent();
  }
}
