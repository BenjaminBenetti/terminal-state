// Task studio-skyways-level-20261106-054448 (lane FOOD): draws the Skyways ramen restaurant's prop kinds (gen/skyways/kitchenKinds.ts:
// the commercial range, the stock pot and saucepan on it, the sushi mascot on the counter) on their prop placements. Called by
// world/builder.ts for those kinds only (nothing else changes for any other kind or level).
//
// Models: the lazy, level-only `skyways-*` library keys (kitchenKinds.ts skywaysKitchenModelKeysFor via Game.sectionModelKeys), front +Z
// like the prop frame (no turn), uniformly fitted to the footprint's width / depth (the measured real size: k ~ 1) and grounded — the
// range's model keeps its full height (backguard / shelf above the collision cooktop). Instanced through the builder's instanceModel
// (`prop-<kind>` meshes, so damage/propDamage.ts and the loose-prop physics find each instance like every model prop). A model the
// library could not load (Node tests, a 404) draws a plain box stand-in of the footprint in the existing shape materials (never
// presented as the art; the collision is the same either way).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import type {ShapeMat, ShapePart} from '../gen/propShapes';
import {SKYWAYS_FOOD_MODELS} from '../assets/skywaysFoodModels';
import {SKYWAYS_KITCHEN_MODEL, skywaysKitchenModelKey, type SkywaysKitchenKind} from '../gen/skyways/kitchenKinds';
import {shapeMaterials} from './shapeMaterials';
import type {WorldMaterials} from './materials';

type Fit = {w: number; h: number; d: number; anchor: 'bottom' | 'top'};
type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: Fit, name: string) => number;

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

const sizes = new WeakMap<GLTF, THREE.Vector3>();
function modelSize(g: GLTF): THREE.Vector3 {
  let v = sizes.get(g);
  if (!v) { g.scene.updateMatrixWorld(true); v = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()); sizes.set(g, v); }
  return v;
}

/** Uniform runtime fit of a kind's model: k = min(footprint w / model x, footprint d / model z) (the real size: ~1). */
export function skywaysKitchenFit(kind: SkywaysKitchenKind, size: {x: number; y: number; z: number}): Fit {
  const def = PROP_DEFS[kind];
  const k = Math.min(def.w / (size.x || 1), def.d / (size.z || 1));
  return {w: size.x * k, h: size.y * k, d: size.z * k, anchor: 'bottom'};
}

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

/** Stand-in box parts (prop frame: origin bottom centre, front +Z) while a kind's model is not loaded: the real footprint / height. */
export function skywaysKitchenShape(kind: SkywaysKitchenKind): ShapePart[] {
  const def = PROP_DEFS[kind], {w, d, h} = def;
  const full = SKYWAYS_FOOD_MODELS[SKYWAYS_KITCHEN_MODEL[kind]].h;
  switch (kind) {
    case 'skywaysRange':
      // body to the cooktop, black burner grates on it, the thin backguard rising behind
      return [box('kitchenSteel', [w, h - 0.03, d], [0, (h - 0.03) / 2, 0]), box('black', [w * 0.94, 0.03, d * 0.8], [0, h - 0.015, 0.03]),
        box('kitchenSteel', [w, Math.max(0.05, full - h), 0.05], [0, h + Math.max(0.05, full - h) / 2, -d / 2 + 0.025])];
    case 'skywaysStockPot': return [box('steelBright', [d, h * 0.92, d], [0, h * 0.46, 0]), box('steelBright', [w, 0.03, 0.04], [0, h * 0.75, 0])];
    case 'skywaysSaucepan': return [box('steelDark', [d, h, d], [w / 2 - d / 2, h / 2, 0]), box('black', [w - d, 0.025, 0.03], [-d / 2, h * 0.8, 0])];
    case 'skywaysSushiMascot': return [box('porcelain', [w, h, d], [0, h / 2, 0])];
  }
}

/** Renders one kitchen kind's placements (model when loaded, else the stand-in). Returns the instance count. */
export function buildSkywaysKitchenProp(group: THREE.Group, kind: SkywaysKitchenKind, list: PropPlacement[], wm: WorldMaterials, instanceModel: InstanceModel,
  lib: Readonly<Record<string, GLTF | undefined>>): number {
  if (!list.length) return 0;
  const gltf = lib[skywaysKitchenModelKey(kind)];
  if (gltf) return instanceModel(group, gltf, list.map(placeM), skywaysKitchenFit(kind, modelSize(gltf)), kind);
  // stand-in: one merged geometry per shape material, instanced per storey (userData.level: the level culler)
  const pm = shapeMaterials(wm);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of skywaysKitchenShape(kind)) {
    const b = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
    b.translate(part.p[0], part.p[1], part.p[2]);
    let l = byMat.get(part.m);
    if (!l) byMat.set(part.m, (l = []));
    l.push(b);
  }
  const byLevel = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byLevel.get(p.level ?? 0); if (l) l.push(p); else byLevel.set(p.level ?? 0, [p]); }
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    geo.computeBoundingSphere();
    for (const [level, ps] of byLevel) {
      const im = new THREE.InstancedMesh(geo, pm[m], ps.length);
      ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
      im.name = `prop-${kind}-${m}`;
      im.userData.level = level;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  return list.length;
}
