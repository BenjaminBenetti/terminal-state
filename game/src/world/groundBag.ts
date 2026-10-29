// Iteration 16 (lane GEAR): a backpack lying on the floor — the physical bag (lane ASSETS' Meshy A3 derivative through the
// shared item template, world/pickups.ts itemTemplate -> gear/models.ts; procedural stand-in until it is delivered),
// standing upright on its storey, front toward where the player stood. It is NOT a pickup: it is not in
// game.pickups.list (never auto-taken, never saved as a dropped item); [E] on it opens the transfer view.
//
// Targeting follows the pickup rules (world/pickups.ts PickupManager.target): within reach, roughly under the crosshair
// (or right at your feet), and in 3D sight from the eye — never through a wall, slab or stair flight.

import * as THREE from 'three';
import type {ItemStack} from '../items/inventory';
import {makeSupplyMesh} from './pickups';
import {Grid} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {BagHost} from '../gear/bagSession';

/** Reach (m, eye to the bag's centre) for [E]. */
export const BAG_REACH = 2.3;
/** The open transfer view closes beyond this horizontal distance (m) from the bag. */
export const BAG_VIEW_RANGE = 2.5;

export interface BagPose { x: number; y: number; z: number; yaw: number; level: number }

let nextSerial = 1;

export class GroundBag implements BagHost {
  readonly obj: THREE.Object3D;
  readonly mats: THREE.MeshStandardMaterial[] = [];
  grounded = true;
  readonly serial = nextSerial++;

  constructor(readonly id: string, readonly stack: ItemStack, readonly pose: BagPose) {
    this.obj = makeBagObject();
    this.obj.name = `ground-bag-${id}`;
    this.obj.position.set(pose.x, pose.y, pose.z);
    this.obj.rotation.y = pose.yaw;
    this.obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map(mm => { const c = (mm as THREE.MeshStandardMaterial).clone(); this.mats.push(c); return c; });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
    });
    this.obj.updateMatrixWorld(true);
  }

  /** Centre used for targeting (about mid-height of the bag). */
  get centre(): THREE.Vector3 {
    return new THREE.Vector3(this.pose.x, this.pose.y + 0.26, this.pose.z);
  }

  /** Emissive look-at highlight (k = 0: the faint readability glow of loose items). */
  glow(k: number): void {
    for (const m of this.mats) m.emissive?.setRGB(k, k * 0.85, k * 0.55);
  }

  /** Leaves the world (worn / section teardown). Geometry is shared with the template; only the material clones go. */
  dispose(): void {
    this.grounded = false;
    this.obj.parent?.remove(this.obj);
    for (const m of this.mats) m.dispose();
  }
}

/** The bag model: the shared backpack item template (same factory as pickups / icons / warm-up prototypes). */
export function makeBagObject(): THREE.Object3D {
  return makeSupplyMesh('backpack');
}

/** The bag the player is looking at within reach and in sight, or null (pure apart from the vectors). */
export function bagTarget(bags: readonly GroundBag[], eye: THREE.Vector3, dir: THREE.Vector3, world: Grid | Levels): GroundBag | null {
  const grid = world instanceof Grid ? world : null;
  const levels = grid ? null : (world as Levels);
  let best: GroundBag | null = null, bestScore = Infinity;
  const v = new THREE.Vector3();
  for (const b of bags) {
    if (!b.grounded) continue;
    const c = b.centre;
    v.subVectors(c, eye);
    const d = v.length();
    if (d > BAG_REACH || d < 1e-4) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, v.dot(dir) / d)));
    const flat = Math.hypot(c.x - eye.x, c.z - eye.z);
    if (!(ang < 0.36 || (flat < 0.9 && ang < 1.0))) continue;
    const top = {x: c.x, y: b.pose.y + 0.45, z: c.z};
    const seen = grid ? grid.lineOfSight(eye.x, eye.z, c.x, c.z)
      : levels!.lineOfSight(eye, {x: c.x, y: c.y, z: c.z}, {slack: 0.15}) || levels!.lineOfSight(eye, top, {slack: 0.15});
    if (!seen) continue;
    const score = ang + d * 0.08;
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}
