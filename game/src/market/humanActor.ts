// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): one rendered friendly human — an assembled appearance
// (market/humanWardrobe.ts) driven by an AnimationMixer over the body's HEALTHY clips with crossfades. No hit volumes, no ragdoll,
// no damage / wound materials: humans are not combat targets (they never join game.zombies).

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
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<HumanClip, THREE.AnimationAction>();
  /** The loop currently shown (a one-shot returns to it). */
  loop: HumanClip = 'Idle';
  private oneShot: HumanClip | null = null;
  current: HumanClip | null = null;
  /** World pose (feet): written by the owner, applied by sync(). */
  x = 0; y = 0; z = 0; yaw = 0;
  /** Animation time not yet applied (far actors update every few frames). */
  private pendingDt = 0;
  private readonly finished = (e: {action: THREE.AnimationAction}) => { if (this.oneShot && e.action === this.actions.get(this.oneShot)) { this.oneShot = null; this.play(this.loop, 0.35); } };

  constructor(app: HumanAppearance, phase = 0) {
    this.root = app.root;
    this.look = app.look;
    this.scale = app.look.scale;
    this.meshes = app.meshes;
    this.walkSpeed = app.walkSpeed * this.scale;
    this.heightM = app.heightM * this.scale;
    this.root.scale.setScalar(this.scale);
    for (const m of this.meshes) m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, CULL.y, 0), CULL.r);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [name, clip] of app.clips) {
      const a = this.mixer.clipAction(clip);
      // (clamped: the last frame holds while the loop fades back in, never a blend from the bind pose)
      if (HUMAN_ONE_SHOTS.includes(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(name, a);
    }
    this.mixer.addEventListener('finished', this.finished as never);
    this.play('Idle', 0);
    // desync the loops of people standing side by side
    const idle = this.actions.get('Idle');
    if (idle) idle.time = phase * idle.getClip().duration;
  }

  has(name: HumanClip): boolean { return this.actions.has(name); }

  /** Crossfade to a clip (a one-shot plays once, then the current loop resumes). */
  play(name: HumanClip, fade = 0.3): void {
    const next = this.actions.get(name);
    if (!next) return;
    if (HUMAN_ONE_SHOTS.includes(name)) this.oneShot = name;
    else { this.loop = name; if (this.oneShot) return; }
    if (this.current === name && !HUMAN_ONE_SHOTS.includes(name)) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  /** Playing a one-shot (the greeting). */
  get busy(): boolean { return this.oneShot !== null; }

  /**
   * Advance the animation. `speed` = ground speed while walking (the Walk playback rate follows it); `stride` > 1 applies the
   * accumulated time only every `stride`-th call (distant people: bounded per-frame cost).
   */
  animate(dt: number, speed = 0, stride = 1, tick = 0): void {
    this.pendingDt += dt;
    if (stride > 1 && tick % stride !== 0) return;
    const a = this.current === 'Walk' ? this.actions.get('Walk') : null;
    if (a) a.setEffectiveTimeScale(Math.max(0.5, Math.min(1.6, speed / Math.max(0.1, this.walkSpeed))) || 1);
    this.mixer.update(this.pendingDt);
    this.pendingDt = 0;
  }

  sync(): void {
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
