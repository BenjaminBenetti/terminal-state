// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH): drawing the merchandise Skyways version 4 split off its shop fixtures
// (gen/skyways/skywaysMerchSplit.ts; kinds gen/skyways/stores/kinds/merch.ts):
//  - the device wall (tech-display-t25.glb, Meshy T2.5, maps kept): a DETERMINISTIC LOCAL MESH SEPARATION of the model at runtime — its
//    fitted triangles cut exactly at the WALL_DEVICE_CUT planes (world/meshSplit.ts partition) into the bare wall unit and its four
//    display devices, each drawn with the model's own material and UVs. The GLB on disk is untouched; one split per loaded model;
//  - the bare demo table: the table's own authored parts without the devices (their parts now draw the skyMerchDemo* props: the dest
//    kinds' generic `parts` path in world/skywaysDestinations.ts);
//  - a faced-out LP: the record store's own sleeve geometry and cover atlas (world/skywaysStoreMusic.ts facedSleeveGeometry).
// Without the model (Node tests, a 404) a wall device draws as a plain box of its measured size (never presented as the model).
// Every mesh is named `prop-<kind>[-<suffix>]` with userData.level (damage/propDamage.ts finds each instance; the level culler).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import type {PurposePart} from '../gen/purposeShapes';
import {DEMO_TABLE, MERCH_BARE_VARIANT, WALL_DEVICES, WALL_DEVICE_CUT, wallDeviceBucket} from '../gen/skyways/stores/kinds/merch';
import {fittedMeshes, partition, soupGeometry} from './meshSplit';
import {facedSleeveGeometry, storeMusicArtMaterial} from './skywaysStoreMusic';
import {shapeMaterials} from './shapeMaterials';
import type {WorldMaterials} from './materials';

/** A techDisplay / deviceWall placement whose merchandise stands as separate props: drawn bare. */
export const isMerchBare = (kind: string, variant: number): boolean => (kind === 'techDisplay' || kind === 'deviceWall') && variant === MERCH_BARE_VARIANT;

/** The bare demo table: its authored parts up to the table top (base, body, band, top, the price labels) — the devices are props now. */
export function bareTechTableParts(parts: readonly PurposePart[]): PurposePart[] {
  return parts.filter(p => p.p[1] + p.s[1] / 2 <= DEMO_TABLE.top + 0.006);
}

// ---------------------------------------------------------------------------------------------
// The device wall's model split

interface WallSplit { body: GLTF; devices: Map<number, {geo: THREE.BufferGeometry; mat: THREE.Material}[]> }
const SPLITS = new WeakMap<GLTF, WallSplit>();

/**
 * The device wall model (the deviceWall's model, fitted to its PROP_DEFS box like the instanced model) cut into the bare unit (a GLTF of
 * one mesh per source mesh, in the fitted frame: base y 0, centred — instancing it re-fits it at scale 1) and the four devices (bucket
 * 1..4 left to right: geometry relative to the device's bottom centre in WALL_DEVICES). Cached per model.
 */
export function splitDeviceWall(gltf: GLTF): WallSplit {
  let s = SPLITS.get(gltf);
  if (s) return s;
  const {w, h, d} = PROP_DEFS.deviceWall, C = WALL_DEVICE_CUT;
  const region = new THREE.Box3(new THREE.Vector3(-w, C.y0, C.z0), new THREE.Vector3(w, C.y1, C.z1));
  const planes = [{axis: 1 as const, value: C.y0}, {axis: 1 as const, value: C.y1}, {axis: 2 as const, value: C.z0}, {axis: 2 as const, value: C.z1}, ...C.xs.map(value => ({axis: 0 as const, value}))];
  const scene = new THREE.Group();
  const devices = new Map<number, {geo: THREE.BufferGeometry; mat: THREE.Material}[]>();
  for (const m of fittedMeshes(gltf, w, h, d)) {
    const buckets = partition(m.soup, planes, region, 1 + WALL_DEVICES.length, c =>
      c.y > C.y0 && c.y < C.y1 && c.z > C.z0 && c.z < C.z1 ? 1 + C.xs.filter(x => c.x > x).length : 0);
    if (buckets[0].length) {
      const mesh = new THREE.Mesh(soupGeometry(m.soup, buckets[0]), m.mat);
      mesh.name = m.name;
      scene.add(mesh);
    }
    WALL_DEVICES.forEach((dv, k) => {
      const data = buckets[k + 1];
      if (!data.length) return;
      const origin = new THREE.Vector3((dv.x0 + dv.x1) / 2, C.y0, (dv.z0 + dv.z1) / 2);
      const l = devices.get(k + 1) ?? [];
      l.push({geo: soupGeometry(m.soup, data, origin), mat: m.mat});
      devices.set(k + 1, l);
    });
  }
  scene.updateMatrixWorld(true);
  s = {body: {scene} as unknown as GLTF, devices};
  SPLITS.set(gltf, s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Drawing the split kinds

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): void {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const byLevel = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byLevel.get(p.level ?? 0); if (l) l.push(p); else byLevel.set(p.level ?? 0, [p]); }
  for (const [level, ps] of byLevel) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}
const groupBy = (list: readonly PropPlacement[], key: (p: PropPlacement) => number): Map<number, PropPlacement[]> => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const k = key(p), l = m.get(k); if (l) l.push(p); else m.set(k, [p]); }
  return m;
};
const STAND_IN = new Map<string, THREE.BufferGeometry>();

/** The split kinds this module draws (the demo devices draw through their spec's parts). */
export const isMerchSplitDrawn = (kind: string): boolean => kind === 'skyMerchWallPhone' || kind === 'skyMerchWallTablet' || kind === 'skyMerchFacedLp';

/** Draws a split kind's placements; `lib` the level's model record (the deviceWall's model key). Returns the instance count. */
export function buildMerchSplitProp(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, lib: Readonly<Record<string, GLTF | undefined>>, modelKey = 'techDisplay'): number {
  if (!list.length) return 0;
  if (kind === 'skyMerchFacedLp') {
    for (const [cover, ps] of groupBy(list, p => p.variant)) instanced(group, facedSleeveGeometry(cover), storeMusicArtMaterial('covers'), ps, `prop-${kind}-c${cover}`);
    return list.length;
  }
  const model = lib[modelKey];
  const split = model ? splitDeviceWall(model) : null;
  for (const [variant, ps] of groupBy(list, p => ((p.variant % 2) + 2) % 2)) {
    const b = wallDeviceBucket(kind, variant), parts = split?.devices.get(b);
    if (parts?.length) { parts.forEach((q, i) => instanced(group, q.geo, q.mat, ps, `prop-${kind}-v${variant}-${i}`)); continue; }
    // no model: a plain box of the device's measured size (the collision is the same either way)
    const dv = WALL_DEVICES[b - 1], key = `${kind}:${variant}`;
    let g = STAND_IN.get(key);
    if (!g) { g = new THREE.BoxGeometry(dv.x1 - dv.x0, dv.y1 - WALL_DEVICE_CUT.y0, dv.z1 - dv.z0); g.translate(0, (dv.y1 - WALL_DEVICE_CUT.y0) / 2, 0); STAND_IN.set(key, g); }
    instanced(group, g, shapeMaterials(wm).black, ps, `prop-${kind}-v${variant}-standin`);
  }
  return list.length;
}
