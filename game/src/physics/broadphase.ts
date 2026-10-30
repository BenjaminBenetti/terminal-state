// Task office-props-physics-scale-20261030 (lane PHYS): broadphase + collision bookkeeping that stay linear in the number of
// STATIC bodies.
//
// The lazy static collision chunks (physics/world.ts) of the 9-storey Office tower hold ~80-300 boxes each (every storey's slab /
// wall boxes and prop boxes of the 4 m column), so a few simulating bodies there keep ~1300 static bodies in the cannon world.
// Two cannon-es parts are quadratic in that count and cost ~20 ms per step there (measured: 4 awake props, 1341 statics):
//  - SAPBroadphase.collisionPairs: for every body it walks the rest of the sorted axis list and only `continue`s past a pair of
//    two static / sleeping bodies (the `break` on the axis bound is reached only by a pair that needs testing), i.e. N^2 / 2
//    filter calls per step with N statics;
//  - World.collisionMatrix (ArrayCollisionMatrix): reset() clears N^2 / 2 slots every step (it only feeds the first-contact
//    'collide' events).
// LiveSAPBroadphase produces EXACTLY the pairs of SAPBroadphase, in the same order (so contact / solver order and every
// simulated trajectory are unchanged): a static or sleeping body can only pair with a live (awake, non-static) one — SAP
// skips every other partner with `continue` — so it walks just the live bodies after it in the sorted list, with SAP's own
// filter / bound / break logic. useSparseCollisionMatrix() swaps the world's two collision matrices for cannon-es's
// ObjectCollisionMatrix (keyed by body id: O(1) reset; also right across add / remove, unlike the index-keyed array).

import * as CANNON from 'cannon-es';

export class LiveSAPBroadphase extends CANNON.SAPBroadphase {
  /** Sorted-list indices of the live bodies this step (scratch). */
  private readonly live: number[] = [];

  collisionPairs(_world: CANNON.World, p1: CANNON.Body[], p2: CANNON.Body[]): void {
    const bodies = this.axisList;
    const N = bodies.length;
    const axis = this.axisIndex;
    if (this.dirty) {
      this.sortList();
      this.dirty = false;
    }
    const live = this.live;
    live.length = 0;
    for (let i = 0; i < N; i++) if (isLive(bodies[i])) live.push(i);
    let k = 0;
    for (let i = 0; i !== N; i++) {
      const bi = bodies[i];
      while (k < live.length && live[k] <= i) k++;
      if (!isLive(bi)) {
        // static / sleeping: SAP `continue`s past every static / sleeping partner, so only the live ones after it matter
        for (let m = k; m < live.length; m++) {
          const bj = bodies[live[m]];
          if (!this.needBroadphaseCollision(bi, bj)) continue;
          if (!CANNON.SAPBroadphase.checkBounds(bi, bj, axis)) break;
          this.intersectionTest(bi, bj, p1, p2);
        }
        continue;
      }
      for (let j = i + 1; j < N; j++) {
        const bj = bodies[j];
        if (!this.needBroadphaseCollision(bi, bj)) continue;
        if (!CANNON.SAPBroadphase.checkBounds(bi, bj, axis)) break;
        this.intersectionTest(bi, bj, p1, p2);
      }
    }
  }
}

/** Neither static nor sleeping (Broadphase.needBroadphaseCollision's type test). */
function isLive(b: CANNON.Body): boolean {
  return (b.type & CANNON.Body.STATIC) === 0 && b.sleepState !== CANNON.Body.SLEEPING;
}

/** Lane PHYS: the world's first-contact matrices keyed by body id (O(1) reset per step instead of O(N^2)). */
export function useSparseCollisionMatrix(w: CANNON.World): void {
  w.collisionMatrix = new CANNON.ObjectCollisionMatrix() as unknown as CANNON.ArrayCollisionMatrix;
  w.collisionMatrixPrevious = new CANNON.ObjectCollisionMatrix() as unknown as CANNON.ArrayCollisionMatrix;
}
