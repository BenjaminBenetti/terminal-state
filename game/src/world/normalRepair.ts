// Task studio-beta-campaign-polish-20261103-063841-01 (lane MENU, item 3): DETERMINISTIC NORMAL REPAIR of a cooked model's geometry
// (processing, not authoring: no vertex moves, no new art, the GLB file is untouched).
//
// The title diorama's "black triangles" on the background building left of the train: the cooked Meshy ruined tower
// (office-ruined-tower.glb) carries 254 vertices whose NORMAL is the zero vector (54 triangles have all three such vertices, about
// 213 m² of facade; the ruined mid-rise has 262 / 24). three's node materials normalize the interpolated normal per fragment, so a
// triangle whose three normals are zero shades with normalize(0) = NaN — drawn black through the light and fog terms; triangles with
// one or two such vertices shade erratically toward them. repairZeroNormals gives every zero (or non-finite) normal the area-weighted
// mean of its adjacent faces (each face oriented to agree with the first one, so an inconsistently wound neighbour cannot cancel it),
// and leaves every valid normal exactly as it was. Idempotent (a flag in userData; a repaired normal is never zero again).

import type * as THREE from 'three';

const EPS = 1e-6;

/** Vertices whose normal is zero-length or non-finite (the shader would normalize it to NaN). */
export function zeroNormalVertices(g: THREE.BufferGeometry): number[] {
  const n = g.getAttribute('normal');
  if (!n) return [];
  const out: number[] = [];
  for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    if (!Number.isFinite(l) || l < EPS) out.push(i);
  }
  return out;
}

/**
 * Repair zero / non-finite vertex normals in place from the adjacent faces (see the header). Returns how many vertices were repaired
 * (0 when the geometry was already clean or repaired before). A vertex no non-degenerate face touches gets +Y.
 */
export function repairZeroNormals(g: THREE.BufferGeometry): number {
  if (g.userData?.zeroNormalsRepaired) return 0;
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  if (!n || !p) return 0;
  const bad = zeroNormalVertices(g);
  g.userData.zeroNormalsRepaired = true;
  if (!bad.length) return 0;
  const slot = new Map<number, number>();
  bad.forEach((v, k) => slot.set(v, k));
  const acc = new Float64Array(bad.length * 3);
  const idx = g.getIndex();
  const tris = idx ? idx.count / 3 : p.count / 3;
  const vert = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < tris; t++) {
    const a = vert(t, 0), b = vert(t, 1), c = vert(t, 2);
    const sa = slot.get(a), sb = slot.get(b), sc = slot.get(c);
    if (sa === undefined && sb === undefined && sc === undefined) continue;
    const ux = p.getX(b) - p.getX(a), uy = p.getY(b) - p.getY(a), uz = p.getZ(b) - p.getZ(a);
    const vx = p.getX(c) - p.getX(a), vy = p.getY(c) - p.getY(a), vz = p.getZ(c) - p.getZ(a);
    // the cross product's length = twice the area: an area-weighted face normal
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < EPS * EPS) continue;
    for (const s of [sa, sb, sc]) {
      if (s === undefined) continue;
      const o = s * 3, agree = acc[o] * fx + acc[o + 1] * fy + acc[o + 2] * fz >= 0 ? 1 : -1;
      acc[o] += agree * fx; acc[o + 1] += agree * fy; acc[o + 2] += agree * fz;
    }
  }
  bad.forEach((v, k) => {
    const o = k * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]);
    if (l > EPS * EPS) n.setXYZ(v, acc[o] / l, acc[o + 1] / l, acc[o + 2] / l);
    else n.setXYZ(v, 0, 1, 0);
  });
  n.needsUpdate = true;
  return bad.length;
}
