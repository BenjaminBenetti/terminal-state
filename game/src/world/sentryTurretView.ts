// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): the sentry's ROOF TURRET as a thing you see (world/sentryTurret.ts
// drives it) — train-local, a child of the car's view root at craft/trainFixtures.ts turretMount.
//
// THE MODEL: the cooked turret (assets/trainEquipment.generated.ts TRAIN_EQUIPMENT_MODELS.turret, a clone of the prop library's GLB; its
// geometry / materials stay the library's, never disposed here). Its frame: origin on the yaw axis at the underside of the base ring,
// +Z = the muzzle at rest; nodes 'turret-base' (fixed), 'turret-yoke' (turns about +Y through the origin), 'turret-head' (tilts about
// the X axis through TRAIN_TURRET_MEASURED.pitchPivot; absent / unused when `pitch` is false). The nodes are re-parented under two
// pivot groups placed in the MODEL frame (attach keeps every part where the cook put it), so the turn / tilt axes are the documented
// ones whatever the nodes' own origins are. Without a yoke node the whole model turns; without a head it does not tilt.
// THE STAND-IN (no model in the library yet: the cook has not landed, or a Node test): a plain base disc, pedestal, box head and barrel
// at the measured size — authored geometry with two plain materials, replaced the moment the model is there.
//
// POSE: deploy 0..1 — the turret sinks along Y into the roof cavity (at most down to the saloon's ceiling lining: never through it) and
// is HIDDEN at 0 (the roof skin covers the stowed turret); yaw about +Y (0 = the car's +Z), pitch = elevation (up positive).

import * as THREE from 'three';
import {TRAIN_TURRET_MEASURED} from '../assets/trainEquipment.generated';
import {turretMount} from '../craft/trainFixtures';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';

/** Tuning of the look (one place). */
export const SENTRY_VIEW = {
  /** The stowed turret keeps this far above the saloon's ceiling lining (m). */
  ceilingGap: 0.01,
  /** The stand-in: base disc height, pedestal radius, head box height cap, barrel radius, colours. */
  standIn: {base: 0.1, pedestal: 0.09, head: 0.26, headFront: 0.2, barrel: 0.022, steel: 0x3b4046, dark: 0x1c1e21},
} as const;

const ease = (t: number) => t * t * (3 - 2 * t);

export class SentryTurretView {
  /** At the mount (train-local): y sinks while it stows. */
  readonly root = new THREE.Group();
  /** The model frame (origin on the yaw axis at the base's underside). */
  private readonly frame = new THREE.Group();
  /** Turns about +Y through the origin: the yoke (+ the head's pivot). */
  private yawPivot = new THREE.Group();
  /** Tilts about X through the pitch pivot: the head (null: this turret cannot tilt). */
  private pitchPivot: THREE.Group | null = null;
  /** The cooked model's clone (null: the stand-in is shown). */
  model: THREE.Object3D | null = null;
  private modelSrc: THREE.Object3D | null = null;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  /** How far the stowed turret sits below its deployed place (m). */
  readonly sink: number;
  readonly mountY: number;
  deploy = 0;
  yaw = 0;
  pitch = 0;

  constructor(readonly spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC) {
    const m = turretMount(spec);
    this.mountY = m.y;
    this.sink = Math.max(0.05, Math.min(TRAIN_TURRET_MEASURED.size.h, m.y - spec.ceilingY - SENTRY_VIEW.ceilingGap));
    this.root.name = 'train-turret';
    this.root.position.set(m.x, m.y - this.sink, m.z);
    this.root.visible = false;
    this.frame.name = 'train-turret-frame';
    this.root.add(this.frame);
    this.buildStandIn();
  }

  /** The plain stand-in at the measured size (shown until the cooked model is in the library). */
  private buildStandIn(): void {
    const M = TRAIN_TURRET_MEASURED, S = SENTRY_VIEW.standIn, P = M.pitchPivot;
    const steel = new THREE.MeshStandardMaterial({name: 'train-turret-steel', color: S.steel, roughness: 0.55, metalness: 0.6});
    const dark = new THREE.MeshStandardMaterial({name: 'train-turret-dark', color: S.dark, roughness: 0.4, metalness: 0.7});
    this.mats.push(steel, dark);
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, name: string, parent: THREE.Object3D) => {
      const o = new THREE.Mesh(g, mat);
      o.name = name;
      o.raycast = () => {};
      this.geos.push(g);
      parent.add(o);
      return o;
    };
    const r = M.size.w / 2;
    mk(new THREE.CylinderGeometry(r * 0.92, r, S.base, 20).translate(0, S.base / 2, 0), steel, 'turret-base', this.frame);
    this.yawPivot = new THREE.Group();
    this.yawPivot.name = 'train-turret-yaw';
    this.frame.add(this.yawPivot);
    const pedH = Math.max(0.02, P.y - S.base);
    mk(new THREE.CylinderGeometry(S.pedestal, S.pedestal * 1.25, pedH, 14).translate(0, S.base + pedH / 2, 0), steel, 'turret-yoke', this.yawPivot);
    this.pitchPivot = new THREE.Group();
    this.pitchPivot.name = 'train-turret-pitch';
    this.pitchPivot.position.set(P.x, P.y, P.z);
    this.yawPivot.add(this.pitchPivot);
    // the head box round the tilt axis (its rear end at the model's rear extent), the barrel out to the measured muzzle
    const rear = -(M.size.l - M.muzzle.z) - P.z, front = S.headFront, hh = Math.min(S.head, 2 * (M.size.h - P.y));
    mk(new THREE.BoxGeometry(M.size.w * 0.62, hh, front - rear).translate(0, 0, (front + rear) / 2), steel, 'turret-head', this.pitchPivot);
    const tip = M.muzzle.z - P.z, len = Math.max(0.05, tip - front);
    mk(new THREE.CylinderGeometry(S.barrel, S.barrel, len, 10).rotateX(Math.PI / 2).translate(M.muzzle.x - P.x, M.muzzle.y - P.y, front + len / 2), dark, 'turret-barrel', this.pitchPivot);
  }

  /**
   * The cooked model (the prop library's GLB scene; null = none yet). Cloned once per source; the stand-in goes. Returns true when the
   * model is (now) shown.
   */
  setModel(src: THREE.Object3D | null): boolean {
    if (!src || src === this.modelSrc) return !!this.model;
    // out with what was there (the stand-in's own geometry / materials; an older clone's are the library's)
    this.frame.clear();
    for (const g of this.geos.splice(0)) g.dispose();
    for (const m of this.mats.splice(0)) m.dispose();
    const m = src.clone(true);
    m.name = 'train-turret-model';
    m.traverse(o => { o.raycast = () => {}; });
    this.frame.add(m);
    this.yawPivot = new THREE.Group();
    this.yawPivot.name = 'train-turret-yaw';
    this.frame.add(this.yawPivot);
    this.pitchPivot = null;
    // the pivots sit in the MODEL frame; attach() keeps every node's place in it (the frame's world matrix is whatever the car's is)
    this.root.updateWorldMatrix(true, true);
    const yoke = m.getObjectByName('turret-yoke'), head = TRAIN_TURRET_MEASURED.pitch ? m.getObjectByName('turret-head') : undefined;
    this.yawPivot.attach(yoke ?? m);
    if (head) {
      const P = TRAIN_TURRET_MEASURED.pitchPivot;
      this.pitchPivot = new THREE.Group();
      this.pitchPivot.name = 'train-turret-pitch';
      this.pitchPivot.position.set(P.x, P.y, P.z);
      this.yawPivot.add(this.pitchPivot);
      this.root.updateWorldMatrix(true, true);
      this.pitchPivot.attach(head);
    }
    this.model = m;
    this.modelSrc = src;
    this.apply();
    return true;
  }

  /** Deploy 0 (stowed, hidden) .. 1 (up), yaw about +Y (0 = the car's +Z), pitch = elevation (rad, up positive). */
  pose(deploy: number, yaw: number, pitch: number): void {
    const k = Math.max(0, Math.min(1, deploy));
    if (k === this.deploy && yaw === this.yaw && pitch === this.pitch) return;
    this.deploy = k; this.yaw = yaw; this.pitch = pitch;
    this.apply();
  }

  private apply(): void {
    this.root.visible = this.deploy > 0;
    this.root.position.y = this.mountY - (1 - ease(this.deploy)) * this.sink;
    this.yawPivot.rotation.y = this.yaw;
    if (this.pitchPivot) this.pitchPivot.rotation.x = -this.pitch;
  }

  /** The turret can tilt (a head on its own pivot). */
  get tilts(): boolean {
    return !!this.pitchPivot;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.frame.clear();
    for (const g of this.geos.splice(0)) g.dispose();
    for (const m of this.mats.splice(0)) m.dispose();
    this.model = null;
    this.modelSrc = null;
  }
}
