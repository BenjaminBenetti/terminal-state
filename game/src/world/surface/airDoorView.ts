// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's door LEAVES (world/surface/airDoors.ts plans / states
// them): one hinged leaf per door leaf — a painted-steel street door with a push bar, or the checkpoint tent's canvas flap — in the
// existing shape materials (world/shapeMaterials.ts; no new texture, material kind or pipeline: the materials are shared with the props).
// Each leaf is a pivot group at its hinge (static matrices, recomposed only while it swings). Lane LOOK may supply the flap's material
// (`flapMaterial`) to match its tent.

import * as THREE from 'three';
import type {WorldMaterials} from '../materials';
import {shapeMaterial} from '../shapeMaterials';
import {DOOR_RT, doorPoint, leafHeight, leafPose, type SurfaceDoorPlan, type SurfaceDoorState} from './airDoors';

export interface SurfaceDoorView {
  root: THREE.Group;
  /** Per door (same order as the states): its leaf pivots. */
  leaves: THREE.Group[][];
  geometries: THREE.BufferGeometry[];
  /** The open fraction each door's leaves were last posed at. */
  shown: number[];
}

/** Builds every leafed door's leaves (posed at their current open fraction). */
export function buildDoorView(doors: readonly SurfaceDoorState[], mats: WorldMaterials, flapMaterial?: THREE.Material | null): SurfaceDoorView {
  const root = new THREE.Group();
  root.name = 'surface-doors';
  const geos = new Map<string, THREE.BufferGeometry>();
  const geo = (w: number, h: number, d: number): THREE.BufferGeometry => {
    const k = `${w.toFixed(3)}x${h.toFixed(3)}x${d.toFixed(3)}`;
    let g = geos.get(k);
    if (!g) geos.set(k, (g = new THREE.BoxGeometry(w, h, d)));
    return g;
  };
  const steel = shapeMaterial(mats, 'steelDark'), bar = shapeMaterial(mats, 'steelBright');
  const flap = flapMaterial ?? shapeMaterial(mats, 'panel');
  const leaves = doors.map(d => {
    const p = d.plan, H = leafHeight(p);
    return p.leaves.map((l, k) => {
      const pivot = new THREE.Group();
      pivot.name = `surface-door-${p.id}-${k}`;
      pivot.userData.level = p.level;
      const w = l.width - 0.02;
      const slab = new THREE.Mesh(geo(w, H, p.tent ? 0.012 : DOOR_RT.thick), p.tent ? flap : steel);
      slab.position.set(w / 2 + 0.01, H / 2, 0);
      pivot.add(slab);
      if (!p.tent) {
        // the push bar across the leaf (both faces), at 1.0 m
        const pb = new THREE.Mesh(geo(w * 0.7, 0.045, DOOR_RT.thick + 0.07), bar);
        pb.position.set(w * 0.5, 1.0, 0);
        pivot.add(pb);
      }
      root.add(pivot);
      return pivot;
    });
  });
  const view: SurfaceDoorView = {root, leaves, geometries: [...geos.values()], shown: doors.map(() => NaN)};
  root.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  doors.forEach((d, i) => poseDoor(view, d, i));
  return view;
}

/** Poses door i's leaves at its open fraction (no-op when unchanged). True when it moved. */
export function poseDoor(view: SurfaceDoorView, d: SurfaceDoorState, i: number): boolean {
  if (view.shown[i] === d.t) return false;
  view.shown[i] = d.t;
  const p: SurfaceDoorPlan = d.plan;
  p.leaves.forEach((l, k) => {
    const g = view.leaves[i]?.[k];
    if (!g) return;
    const pose = leafPose(p, l, d.t), h = doorPoint(p, l.hinge, DOOR_RT.inset);
    g.position.set(h.x, p.floor, h.z);
    g.rotation.set(0, Math.atan2(-pose.dz, pose.dx), 0); // local +X (the leaf's width) along the pose direction
    g.updateMatrix();
    g.updateMatrixWorld(true);
  });
  return true;
}

export function disposeDoorView(view: SurfaceDoorView): void {
  view.root.removeFromParent();
  for (const g of view.geometries) g.dispose();
}
