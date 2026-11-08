// Task studio-cosplay-general-20261108-225231-01 (lane GENERAL; user: "Subway platform edge z-fighting."): the platform edge lip.
//
// Every track-side platform edge gets a thin concrete lip (world/builder.ts, 'platformFace' trim, merged per trim chunk). Since
// iteration 6 it was a 0.08 x 0.08 m box sunk flush INSIDE the platform: its top lay exactly on the safety-edge floor strip
// (y = the platform floor) and its front exactly on the platform face wall over the track bed (z = the edge), so both of its
// visible faces were coplanar duplicates of other surfaces with different materials / texture mappings — the flicker along every
// platform edge. The lip now stands a few millimetres PROUD of both (a coping nosing: invisible as a step, far beyond depth
// precision at any distance in a station), with world-mapped texture coordinates like the walls / floors (the box's own 0..1 UVs
// smeared the backing texture over a whole trim chunk). Only the lip's render geometry changes: the platform floor, its collision
// grid, the safety strip, the face wall, the trains / doors / thresholds and the culling chunk + level of every lip box are
// unchanged (the chunk key and level are taken at the old box centre).
import * as THREE from 'three';
import {CELL} from '../gen/grid';

/** Lip section (m): depth back from the edge, height down from the floor, and how far it stands proud of the floor / face. */
export const PLATFORM_LIP = {depth: 0.08, height: 0.08, rise: 0.002, proud: 0.003} as const;

/** One lip box: centre + size (world m), the bed side (+1: the bed lies at +z), and the old flush box centre (culling key). */
export interface PlatformLipBox {
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  dir: 1 | -1;
  /** The iteration-6 box centre (y, z): the builder's trim chunk + level resolution keeps using it (culling unchanged). */
  keyY: number; keyZ: number;
}

/** The lip boxes of a platform area (track-side edge(s) per `edge`), split along x by `spans` (the builder's chunk grid). */
export function platformLipBoxes(a: {x: number; y: number; w: number; h: number; edge?: 'N' | 'S' | 'NS'}, floorY: number,
  spans: (x0: number, x1: number) => [number, number][] = (x0, x1) => [[x0, x1]]): PlatformLipBox[] {
  const L = PLATFORM_LIP;
  const edges: [number, 1 | -1][] = a.edge === 'NS' ? [[a.y * CELL, -1], [(a.y + a.h) * CELL, 1]]
    : a.edge === 'S' ? [[(a.y + a.h) * CELL, 1]] : [[a.y * CELL, -1]];
  const out: PlatformLipBox[] = [];
  const y0 = floorY - L.height, y1 = floorY + L.rise;
  for (const [ez, dir] of edges) {
    const outer = ez + dir * L.proud, inner = ez - dir * L.depth;
    for (const [xa, xb] of spans(a.x * CELL, (a.x + a.w) * CELL)) {
      out.push({
        cx: (xa + xb) / 2, cy: (y0 + y1) / 2, cz: (outer + inner) / 2,
        sx: xb - xa, sy: y1 - y0, sz: Math.abs(outer - inner), dir,
        keyY: floorY - L.height / 2, keyZ: ez - dir * L.depth / 2,
      });
    }
  }
  return out;
}

/**
 * The lip box geometry with world-mapped UVs (`scale` = the material's texture span, m): tops as the floors (x, -z), the faces
 * along x as the walls (+-x, y), the ends (-+z, y). Same vertex / index layout as THREE.BoxGeometry (the builder merges it).
 */
export function platformLipGeometry(b: PlatformLipBox, scale: {u: number; v: number}): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz);
  g.translate(b.cx, b.cy, b.cz);
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, x / scale.u, -z / scale.v);
    else if (Math.abs(nz) > 0.5) uv.setXY(i, (nz > 0 ? x : -x) / scale.u, y / scale.v);
    else uv.setXY(i, (nx > 0 ? -z : z) / scale.u, y / scale.v);
  }
  uv.needsUpdate = true;
  return g;
}
