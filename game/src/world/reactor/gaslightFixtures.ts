// Task reactor-expansion-20261101 (lane GASLIGHT): the Reactor pit's MOUNTED lamps in the world — every caged lamp you can see is a real
// fixture of the baked light field (gen/reactor/gaslightLamps.ts: LightPlacement.mount), so its glass glows exactly as its light does:
//  - BODY (into the kit plan, instanced with the rest of the steel; culled per tier band like it): a WALL lamp is the lead's flood-lamp
//    model on its wall plate (top-down while the model's per-level cap lasts) or a procedural cage on a bracket (wall plate + arm);
//    a POST lamp is a steel post on the deck's rail line, an arm over the walkway and the cage hanging from its end;
//  - LENS = the fixture's own tube instance (world/builder.ts light-tubes; world/lights.ts drives its colour from the fixture's
//    state x circuit level: lit = warm glass, dead / held circuit 2 = dark grey glass), placed on the model's lens face or as the bulb
//    inside the cage. There is no other lamp emissive in the pit any more (the kit's decorative per-tier lamps are off when fixtures
//    are given: world/reactor/archKit.ts KitOptions.fixtures) — an orange circle that lights nothing cannot happen.
// Pure placement maths (three.js matrices only); no per-frame work.

import * as THREE from 'three';
import type {LightMount, LightPlacement} from '../../gen/stationTypes';
import {REACTOR_MODELS} from './archAssets';
import {boxMatrix, type KitPlan} from './archKit';

/** A fixture with a mount (the Reactor pit's lamps). */
export type MountedLight = LightPlacement & {mount: LightMount};
export const isMounted = (l: LightPlacement): l is MountedLight => !!l.mount && !l.virtual;

/** Procedural lamp parts (m): wall plate, bracket arm section, cage size, bulb (lens) size; post section / cap above the head. */
export const LAMP_BODY = {plate: [0.22, 0.3, 0.04] as const, arm: 0.05, cage: [0.26, 0.34, 0.26] as const, bulb: [0.13, 0.17, 0.13] as const, post: 0.08, postCap: 0.28} as const;

const UP = new THREE.Vector3(0, 1, 0);

/** What planMountedLamps placed for one light (by layout.lights index). */
export interface MountedLampRec { index: number; model: boolean; lens: THREE.Matrix4 }

/**
 * Lens matrix that maps the tube instance's geometry (world/builder.ts: box w·0.82 x 0.025 x d·0.42, translated to y −h − 0.004)
 * onto a lens of size sx x sy x sz centred at c, its thin axis (local Y) along `n` (the unit direction the glass faces).
 */
export function lensMatrix(c: THREE.Vector3, n: THREE.Vector3, size: readonly [number, number, number], fixture: {w: number; h: number; d: number}): THREE.Matrix4 {
  const y = n.clone().normalize();
  const ref = Math.abs(y.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const x = new THREE.Vector3().crossVectors(ref, y).normalize(), z = new THREE.Vector3().crossVectors(x, y).normalize();
  const basis = new THREE.Matrix4().makeBasis(x.multiplyScalar(size[0] / (fixture.w * 0.82)), y.multiplyScalar(size[1] / 0.025), z.multiplyScalar(size[2] / (fixture.d * 0.42)));
  basis.setPosition(c);
  return basis.multiply(new THREE.Matrix4().makeTranslation(0, fixture.h + 0.004, 0));
}

/** The bulb lens of a procedural cage at the light point (thin axis down: it glows from below and the sides). */
export function bulbLens(l: MountedLight, fixture: {w: number; h: number; d: number}): THREE.Matrix4 {
  const b = LAMP_BODY.bulb;
  return lensMatrix(new THREE.Vector3(l.x, l.y, l.z), new THREE.Vector3(0, -1, 0), [b[0], b[1], b[2]], fixture);
}

/**
 * Plan every mounted lamp's body into the kit (call after planReactorKit with KitOptions.fixtures set, so the flood-lamp model's cap
 * is still free: wall lamps take it top-down). Returns one record per mounted light with its lens matrix.
 */
export function planMountedLamps(plan: KitPlan, lights: readonly LightPlacement[], fixture: {w: number; h: number; d: number}): MountedLampRec[] {
  const out: MountedLampRec[] = [];
  const order = lights.map((_, i) => i).filter(i => isMounted(lights[i])).sort((a, b) => lights[b].y - lights[a].y || a - b);
  const A = REACTOR_MODELS.floodLamp.anchors!, plate = A.plate as readonly number[], lensA = A.lens as readonly number[];
  for (const i of order) {
    const l = lights[i] as MountedLight, m = l.mount;
    const nl = Math.hypot(m.nx, m.nz) || 1, nx = m.nx / nl, nz = m.nz / nl, yaw = Math.atan2(nx, nz); // local +Z -> n
    if (m.kind === 'wall') {
      const band = plan.bandOf(m.y - 0.2);
      if (plan.canModel('floodLamp')) {
        // the flood-lamp model: its wall plate on the mount point; its lens face (anchors.lens) is the fixture's glass
        const ox = m.x - nx * plate[2], oz = m.z - nz * plate[2], oy = m.y - plate[1];
        plan.placeModel('floodLamp', boxMatrix(ox, oy, oz, 1, 1, 1, yaw), band);
        const d = lensA[2] + 0.008;
        const lens = lensMatrix(new THREE.Vector3(ox + nx * d, oy + lensA[1], oz + nz * d), new THREE.Vector3(nx, 0, nz), [A.lensW as number, 0.03, A.lensH as number], fixture);
        out.push({index: i, model: true, lens});
        plan.stats.lamps++;
        continue;
      }
      // procedural: wall plate, bracket arm out to the head, the cage round the bulb (the light point)
      const p = LAMP_BODY.plate;
      plan.box('steelDark', m.x + nx * p[2] / 2, m.y, m.z + nz * p[2] / 2, p[0], p[1], p[2], yaw);
      plan.member('box', 'steelDark', {x: m.x, y: m.y + 0.1, z: m.z}, {x: l.x, y: m.y + 0.1, z: l.z}, LAMP_BODY.arm, LAMP_BODY.arm);
      const c = LAMP_BODY.cage;
      plan.add('cage', 'steelDark', boxMatrix(l.x, l.y, l.z, c[0], c[1], c[2], yaw), band);
      out.push({index: i, model: false, lens: bulbLens(l, fixture)});
      plan.stats.lamps++;
      continue;
    }
    // post: on the deck's rail line from the deck up past the head, an arm over the walkway, the cage hanging under the arm's end
    const top = l.y + LAMP_BODY.postCap;
    plan.member('box', 'steelDark', {x: m.x, y: m.y, z: m.z}, {x: m.x, y: top, z: m.z}, LAMP_BODY.post, LAMP_BODY.post);
    plan.member('box', 'steelDark', {x: m.x, y: top - 0.04, z: m.z}, {x: l.x, y: top - 0.04, z: l.z}, LAMP_BODY.arm, LAMP_BODY.arm);
    plan.member('box', 'steelDark', {x: l.x, y: top - 0.04, z: l.z}, {x: l.x, y: l.y + LAMP_BODY.cage[1] / 2, z: l.z}, 0.02, 0.02);
    const c = LAMP_BODY.cage;
    plan.add('cage', 'steelDark', boxMatrix(l.x, l.y, l.z, c[0], c[1], c[2], yaw), plan.bandOf(m.y + 0.05));
    out.push({index: i, model: false, lens: bulbLens(l, fixture)});
    plan.stats.lamps++;
  }
  return out;
}

/** Write the planned lens matrices into the station's tube InstancedMesh (world/builder.ts 'light-tubes'): instance i = light i. */
export function applyMountedLenses(tubes: THREE.InstancedMesh | null, recs: readonly MountedLampRec[]): number {
  if (!tubes) return 0;
  let n = 0;
  for (const r of recs) if (r.index < tubes.count) { tubes.setMatrixAt(r.index, r.lens); n++; }
  if (n) { tubes.instanceMatrix.needsUpdate = true; tubes.computeBoundingSphere(); }
  return n;
}
