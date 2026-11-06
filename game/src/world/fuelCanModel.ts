// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the PROVISIONAL fuel-can stand-in until an approved model is
// delivered. There is no approved fuel-can model yet (a fresh one is requested separately and is NOT authorized here), so pickups,
// holder lots, the train chest's icons and the warm-up use this plain-colour procedural jerrycan: a pressed-steel body with the X
// pressing on both flat faces and the welded mid seam, the triple carry handle along the seam on top and the spout + cap at the front
// corner. Untextured (no canvas-drawn labels or surface art): two plain MeshStandardMaterials, one merged mesh each.
//
// Frame (world/pickups.ts convention): origin bottom-centre, front +Z, metres; real size = items.ts ITEM_DIMS.fuel_can (a 20 l jerrycan
// standing upright: 0.17 thick (X) x 0.47 tall (Y) x 0.35 long (Z)).
//
// REPLACING IT: world/pickups.ts itemTemplate calls fuelCanModel() for 'fuel_can' — when the approved GLB is delivered, register it as a
// generated item model (ITEM_MODEL_KEYS / fitItemModel, like the food / ammo models) and drop that one branch; nothing else refers to
// this file but the tests.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {itemDims} from '../items/items';

/** Where the fuel can's model comes from (QA / pickups itemModelSources). */
export const FUEL_CAN_MODEL_SOURCE = 'provisional fuel-can stand-in until an approved model is delivered (world/fuelCanModel.ts, plain-colour procedural geometry)';

/** The stand-in's proportions (m). Body + the pressing ribs fill ITEM_DIMS w / d; the spout cap reaches its h. */
export const FUEL_CAN_SHAPE = {bodyH: 0.4, bodyW: 0.162, rib: 0.004, ribW: 0.018, seam: 0.006, handle: {t: 0.022, h: 0.052, z0: -0.165, z1: 0.075, legs: 4}, spout: {r: 0.022, len: 0.05, capR: 0.028, capH: 0.026, tilt: 0.55, z: 0.112}} as const;

let cached: {body: THREE.BufferGeometry; metal: THREE.BufferGeometry; paint: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial} | null = null;

function parts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const D = itemDims('fuel_can'), S = FUEL_CAN_SHAPE;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return g;
  };
  // painted steel: the body, the X pressing on both flat faces (+X / -X), the welded seam flange round the mid plane
  const body: THREE.BufferGeometry[] = [box(S.bodyW, S.bodyH, D.d - 2 * S.seam, 0, S.bodyH / 2, 0)];
  const diag = Math.hypot(S.bodyH * 0.86, (D.d - 2 * S.seam) * 0.86), ang = Math.atan2(S.bodyH * 0.86, (D.d - 2 * S.seam) * 0.86);
  for (const sx of [1, -1]) for (const a of [ang, -ang]) body.push(box(S.rib, S.ribW, diag, sx * (S.bodyW / 2 + S.rib / 2), S.bodyH / 2, 0, a));
  body.push(box(S.seam, S.bodyH + S.seam, D.d, 0, (S.bodyH + S.seam) / 2, 0));
  // bare steel: the triple handle (one bar along the seam on four legs) and the spout neck + cap at the front corner
  const H = S.handle, metal: THREE.BufferGeometry[] = [];
  const barY = S.bodyH + H.h - H.t / 2;
  metal.push(box(H.t, H.t, H.z1 - H.z0 + H.t, 0, barY, (H.z0 + H.z1) / 2));
  for (let i = 0; i < H.legs; i++) metal.push(box(H.t, H.h - H.t, H.t * 0.9, 0, S.bodyH + (H.h - H.t) / 2, H.z0 + (H.z1 - H.z0) * i / (H.legs - 1)));
  const P = S.spout;
  const neck = new THREE.CylinderGeometry(P.r, P.r, P.len, 12);
  neck.translate(0, P.len / 2, 0);
  const cap = new THREE.CylinderGeometry(P.capR, P.capR, P.capH, 12);
  cap.translate(0, P.len + P.capH / 2 - 0.004, 0);
  for (const g of [neck, cap]) { g.rotateX(P.tilt); g.translate(0, S.bodyH - 0.006, P.z); metal.push(g); }
  const merge = (list: THREE.BufferGeometry[]) => { const m = mergeGeometries(list, false); for (const g of list) g.dispose(); m.computeBoundingBox(); m.computeBoundingSphere(); return m; };
  cached = {
    body: merge(body), metal: merge(metal),
    paint: new THREE.MeshStandardMaterial({name: 'fuel-can-provisional-paint', color: 0x8c2a1c, roughness: 0.55, metalness: 0.3}),
    steel: new THREE.MeshStandardMaterial({name: 'fuel-can-provisional-steel', color: 0x2f3235, roughness: 0.45, metalness: 0.6}),
  };
  return cached;
}

/**
 * The provisional fuel-can stand-in until an approved model is delivered (see the header): a fresh Group of two meshes sharing the
 * cached geometry / materials (pickups.ts flags them `userData.shared`; pickups clone the materials for their highlight).
 */
export function fuelCanModel(): THREE.Group {
  const p = parts();
  const g = new THREE.Group();
  g.name = 'fuel-can-provisional';
  const body = new THREE.Mesh(p.body, p.paint);
  body.name = 'fuel-can-body';
  const metal = new THREE.Mesh(p.metal, p.steel);
  metal.name = 'fuel-can-handle-spout';
  g.add(body, metal);
  g.userData.provisional = true;
  return g;
}
