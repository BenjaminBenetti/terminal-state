// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the closed street door of a Surface Run access
// (layout.surfaceAccess.door: the top of the Subway stairwell, the makeshift door in the Office lobby's boarded street doors). Simple
// handmade boxes in the station's existing shape materials (world/shapeMaterials.ts: painted steel leaf, bright steel frame / push bar /
// kick plate, black seams) — no new texture. It is a solid occlusion boundary: nothing of the street is ever behind it in this world.
// One merged mesh per material, added to the section's world group (built before the warm-up, torn down with the world).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {WorldMaterials} from '../materials';
import {shapeMaterial} from '../shapeMaterials';
import type {SurfaceAccessInfo} from '../../gen/surface/surfaceTypes';

type Door = NonNullable<SurfaceAccessInfo['door']>;
type Key = 'steelDark' | 'steelBright' | 'black';

/** Box parts of the door in its local frame (x across the opening, y up from the sill, z out of the wall into the room). */
export function doorParts(d: Pick<Door, 'w' | 'h'>, double: boolean): {m: Key; s: [number, number, number]; p: [number, number, number]}[] {
  const {w, h} = d, F = 0.08, T = 0.05;
  const out: {m: Key; s: [number, number, number]; p: [number, number, number]}[] = [];
  // frame: jambs + head, proud of the wall face
  out.push({m: 'steelBright', s: [F, h + F, 0.1], p: [-w / 2 - F / 2, (h + F) / 2, 0.03]});
  out.push({m: 'steelBright', s: [F, h + F, 0.1], p: [w / 2 + F / 2, (h + F) / 2, 0.03]});
  out.push({m: 'steelBright', s: [w + 2 * F, F, 0.1], p: [0, h + F / 2, 0.03]});
  // leaves (closed), a black seam between a pair
  const leaves = double ? [[-w / 2, 0], [0, w / 2]] : [[-w / 2, w / 2]];
  for (const [a, b] of leaves) {
    const lw = b - a - 0.01, c = (a + b) / 2;
    out.push({m: 'steelDark', s: [lw, h - 0.01, T], p: [c, h / 2, T / 2]});
    out.push({m: 'steelBright', s: [lw - 0.04, 0.22, 0.012], p: [c, 0.13, T + 0.006]}); // kick plate
    // push bar across the leaf with its two brackets
    out.push({m: 'steelBright', s: [lw - 0.18, 0.05, 0.05], p: [c, 1.0, T + 0.07]});
    for (const e of [c - (lw - 0.22) / 2, c + (lw - 0.22) / 2]) out.push({m: 'steelBright', s: [0.05, 0.09, 0.07], p: [e, 1.0, T + 0.035]});
    // a small wired vision panel (dark) high on the leaf
    out.push({m: 'black', s: [Math.min(0.22, lw * 0.3), 0.32, 0.01], p: [c, 1.6, T + 0.005]});
  }
  if (double) out.push({m: 'black', s: [0.012, h - 0.02, T + 0.004], p: [0, h / 2, T / 2]});
  return out;
}

/** The door as meshes (one per material), placed and turned by the record; `userData.surfaceAccess` marks them (QA). */
export function buildAccessDoor(mats: WorldMaterials, d: Door, double: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'surface-access-door';
  const byMat = new Map<Key, THREE.BufferGeometry[]>();
  for (const p of doorParts(d, double)) {
    const b = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    b.translate(p.p[0], p.p[1], p.p[2]);
    let l = byMat.get(p.m);
    if (!l) byMat.set(p.m, (l = []));
    l.push(b);
  }
  const m4 = new THREE.Matrix4().compose(new THREE.Vector3(d.x, d.y, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw), new THREE.Vector3(1, 1, 1));
  for (const [key, list] of byMat) {
    const geo = mergeGeometries(list, false);
    for (const b of list) b.dispose();
    if (!geo) continue;
    geo.applyMatrix4(m4);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, shapeMaterial(mats, key));
    mesh.name = `surface-access-door-${key}`;
    mesh.matrixAutoUpdate = false;
    mesh.userData.surfaceAccess = true;
    mesh.userData.level = d.level;
    mesh.castShadow = false;
    group.add(mesh);
  }
  group.userData.surfaceAccess = true;
  group.matrixAutoUpdate = false;
  return group;
}
