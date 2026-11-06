// Task studio-skyways-level-20261106-054448 (lane ADDON): draws the Skyways add-on's prop kinds (gen/skyways/addonKinds.ts) on their
// placements. Called by world/builder.ts for those kinds only (nothing else changes for any other kind or level).
//
//  - MODEL kinds (stage, merch table, boxed figure, plush, stanchion): the lazy, level-only `skyways-*` library models (front +Z like
//    the prop frame: no turn), uniformly fitted (k = min(footprint w / model x, d / z); the stage by its width: its collision box is
//    the deck, the model is drawn shifted so its deck sits on it) and grounded, through the builder's instanceModel (`prop-<kind>`
//    meshes: damage/propDamage.ts and the loose-prop physics find each instance like every model prop). The stage's variant-1
//    placement (its steps) is collision only. Not loaded (Node tests, a 404): a plain box stand-in of the footprint in the existing
//    shape materials (never presented as the art; the collision is the same either way).
//  - MASCOT STATUES: one InstancedMesh per baked pose node of skyways-mascot-poses.glb (`prop-skywaysMascotStatue-<pose>`), scaled by the
//    placement (h = plinth + pose height x scale) on its concrete plinth; front +Z, any yaw.
//  - ART PANELS (posters, poster boards, banners, the backdrop, the welcome sign, print cards, the prize board): their frame / stand
//    boxes (gen/skyways/addonKinds.ts skywaysAddonShape parts, merged per shape material) and flat quads showing the Codex atlas pieces
//    (assets/skywaysArt.generated.ts UV rects; one geometry per art variant, both faces where the panel is two-sided). The atlas
//    materials are made by world/skywaysAddonRuntime.ts behind the loading screen (level-only textures/skyways/*.jpg via
//    LevelResources) and handed in with setSkywaysAddonArtMaterial; before / without them a plain light board material stands in.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import {SKYWAYS_ART, type SkywaysArtAtlasKey} from '../assets/skywaysArt.generated';
import {SKYWAYS_MESHY_PROPS} from '../assets/skywaysMeshyProps.generated';
import {SKYWAYS_MASCOT, type SkywaysMascotPoseName} from '../assets/skywaysMascot.generated';
import {SKYWAYS_ADDON_MODEL, SKYWAYS_MASCOT_MODEL_KEY, SKYWAYS_MASCOT_POSES, SKYWAYS_STAGE_MODEL_SHIFT, SKYWAYS_STATUE_PLINTH, skywaysAddonModelKey,
  skywaysAddonShape, type AddonArtFace, type AddonPart, type SkywaysAddonKind} from '../gen/skyways/addonKinds';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

type Fit = {w: number; h: number; d: number; anchor: 'bottom' | 'top'};
type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: Fit, name: string) => number;

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

// ---------------------------------------------------------------------------------------------
// Art materials (one per atlas; set by the runtime's preload)

const ART = new Map<SkywaysArtAtlasKey, THREE.Material>();
let plainBoard: THREE.Material | null = null;
/** The runtime hands in an atlas's material (null: forget it). */
export function setSkywaysAddonArtMaterial(atlas: SkywaysArtAtlasKey, m: THREE.Material | null): void {
  if (m) ART.set(atlas, m); else ART.delete(atlas);
}
/** The atlas material, or the plain board stand-in when the atlas is not loaded (never drawn art). */
export function skywaysAddonArtMaterial(atlas: SkywaysArtAtlasKey): THREE.Material {
  const m = ART.get(atlas);
  if (m) return m;
  if (!plainBoard) { plainBoard = new SurfaceNodeMaterial({color: 0xd9d5cc, roughness: 0.85, metalness: 0}); plainBoard.name = 'skyways-addon-board-plain'; }
  return plainBoard;
}
/** Does the art of this atlas show (QA / tests)? */
export const skywaysAddonArtLoaded = (atlas: SkywaysArtAtlasKey): boolean => ART.has(atlas);
/** The atlases a kind's faces use. */
export function skywaysAddonAtlases(kinds: Iterable<string>): SkywaysArtAtlasKey[] {
  const out = new Set<SkywaysArtAtlasKey>();
  for (const k of kinds) for (let v = 0; v < 8; v++) for (const f of skywaysAddonShape(k as SkywaysAddonKind, v).faces) out.add(f.atlas);
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------
// Geometry

const sizes = new WeakMap<object, THREE.Vector3>();
function sizeOf(o: THREE.Object3D): THREE.Vector3 {
  let v = sizes.get(o);
  if (!v) { o.updateMatrixWorld(true); v = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); sizes.set(o, v); }
  return v;
}

/** Uniform runtime fit of a model kind: k = min(w / model x, d / model z) (the stage: its width; its box is the deck only). */
export function skywaysAddonFit(kind: SkywaysAddonKind, size: {x: number; y: number; z: number}): Fit & {k: number} {
  const def = PROP_DEFS[kind];
  const k = kind === 'skywaysConStage' ? def.w / (size.x || 1) : Math.min(def.w / (size.x || 1), def.d / (size.z || 1));
  return {w: size.x * k, h: size.y * k, d: size.z * k, anchor: 'bottom', k};
}

function partGeo(part: AddonPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
  if (part.rx) g.rotateX(part.rx);
  g.translate(part.p[0], part.p[1], part.p[2]);
  return g;
}

/** A quad of an atlas piece (both faces when `back`: the rear one mirrored so it reads the right way round). */
export function artFaceGeometry(f: AddonArtFace): THREE.BufferGeometry {
  const piece = (SKYWAYS_ART[f.atlas].pieces as Record<string, {u0: number; v0: number; u1: number; v1: number}>)[f.piece];
  const quad = (back: boolean) => {
    const g = new THREE.PlaneGeometry(f.w, f.h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = back ? 1 - uv.getX(i) : uv.getX(i), v = uv.getY(i);
      uv.setXY(i, piece.u0 + u * (piece.u1 - piece.u0), piece.v0 + v * (piece.v1 - piece.v0));
    }
    if (back) { g.rotateY(Math.PI); g.translate(0, 0, -0.004); }
    return g;
  };
  const parts = f.back ? [quad(false), quad(true)] : [quad(false)];
  const g = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
  if (parts.length > 1) for (const q of parts) q.dispose();
  if (f.rx) g.rotateX(f.rx);
  g.translate(f.p[0], f.p[1], f.p[2]);
  return g;
}

const byLevel = (list: readonly PropPlacement[]) => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};

/** Instanced per storey (userData.level: the level culler), named `prop-<kind>-<suffix>` (damage / physics find each instance). */
function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string, local?: (p: PropPlacement) => THREE.Matrix4): number {
  geo.computeBoundingSphere();
  for (const [level, ps] of byLevel(list)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, local ? placeM(p).multiply(local(p)) : placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
  return list.length;
}

/** Frame / stand boxes of a kind (merged per shape material) + its art faces per variant. */
function drawShapes(group: THREE.Group, kind: SkywaysAddonKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  const pm = shapeMaterials(wm);
  const byVariant = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
  // frames are the same for every variant (only the art differs)
  const {parts} = skywaysAddonShape(kind, 0);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(partGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], list, `prop-${kind}-${m}`);
  }
  for (const [variant, ps] of byVariant) {
    const faces = skywaysAddonShape(kind, variant).faces;
    if (!faces.length) continue;
    const geos = faces.map(artFaceGeometry);
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, skywaysAddonArtMaterial(faces[0].atlas), ps, `prop-${kind}-art${variant}`);
  }
  return list.length;
}

/** Box stand-in of a model kind's footprint (the stage: its deck and a truss outline). */
function standIn(group: THREE.Group, kind: SkywaysAddonKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  const def = PROP_DEFS[kind], pm = shapeMaterials(wm);
  const parts: AddonPart[] = kind === 'skywaysConStage'
    ? [{m: 'black', s: [def.w, def.h, def.d], p: [0, def.h / 2, 0]}, ...[-1, 1].map(s => ({m: 'steelBright' as ShapeMat, s: [0.3, 4.1, 0.3] as const, p: [s * 3.7, def.h + 2.05, -1.6] as const})),
      {m: 'steelBright', s: [7.7, 0.3, 0.3], p: [0, def.h + 4.0, -1.6]}]
    : kind === 'skywaysPrizeStanchion' ? [{m: 'steelBright', s: [0.34, 0.04, 0.34], p: [0, 0.02, 0]}, {m: 'steelBright', s: [0.06, def.h, 0.06], p: [0, def.h / 2, 0]}]
      : [{m: kind === 'skywaysConMerchTable' ? 'panel' : 'porcelain', s: [def.w, def.h, def.d], p: [0, def.h / 2, 0]}];
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(partGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], list, `prop-${kind}-${m}`);
  }
  return list.length;
}

/** The statues: the plinth (shape parts) + each pose's mesh, scaled by the placement. */
function drawStatues(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials, lib: Readonly<Record<string, GLTF | undefined>>): number {
  drawShapes(group, 'skywaysMascotStatue', list, wm);
  const gltf = lib[SKYWAYS_MASCOT_MODEL_KEY];
  const byPose = new Map<SkywaysMascotPoseName, PropPlacement[]>();
  for (const p of list) {
    const pose = SKYWAYS_MASCOT_POSES[p.variant] ?? 'stand';
    const l = byPose.get(pose); if (l) l.push(p); else byPose.set(pose, [p]);
  }
  const scaleOf = (p: PropPlacement, pose: SkywaysMascotPoseName) => Math.max(0.5, (p.h - SKYWAYS_STATUE_PLINTH.h) / SKYWAYS_MASCOT.poses[pose].h);
  for (const [pose, ps] of byPose) {
    const node = gltf?.scene.getObjectByName(pose);
    const local = (p: PropPlacement) => new THREE.Matrix4().makeTranslation(0, SKYWAYS_STATUE_PLINTH.h, 0).multiply(new THREE.Matrix4().makeScale(scaleOf(p, pose), scaleOf(p, pose), scaleOf(p, pose)));
    if (!node) {
      // stand-in: a pale block of the pose's bounds
      const dims = SKYWAYS_MASCOT.poses[pose];
      const geo = new THREE.BoxGeometry(dims.w * 0.6, dims.h, dims.d * 0.6);
      geo.translate(0, dims.h / 2, 0);
      instanced(group, geo, shapeMaterials(wm).porcelain, ps, `prop-skywaysMascotStatue-${pose}`, local);
      continue;
    }
    gltf!.scene.updateMatrixWorld(true);
    node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const rel = mesh.matrixWorld.clone();
      for (const [level, lp] of byLevel(ps)) {
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, lp.length);
        lp.forEach((p, i) => im.setMatrixAt(i, placeM(p).multiply(local(p)).multiply(rel)));
        im.name = `prop-skywaysMascotStatue-${pose}`;
        im.userData.level = level;
        im.computeBoundingSphere();
        group.add(im);
      }
    });
  }
  return list.length;
}

/** Renders one add-on kind's placements (models when loaded, else stand-ins; art panels). Returns the instance count. */
export function buildSkywaysAddonProp(group: THREE.Group, kind: SkywaysAddonKind, list: PropPlacement[], wm: WorldMaterials, instanceModel: InstanceModel,
  lib: Readonly<Record<string, GLTF | undefined>>): number {
  if (!list.length) return 0;
  if (kind === 'skywaysMascotStatue') return drawStatues(group, list, wm, lib);
  const modelKey = skywaysAddonModelKey(kind);
  if (!modelKey || kind === 'skywaysConBackdrop') return drawShapes(group, kind, list, wm);
  // the stage's variant-1 placement is its steps' collision box (drawn by the stage model)
  const draw = kind === 'skywaysConStage' ? list.filter(p => p.variant === 0) : list;
  const gltf = lib[modelKey];
  if (!gltf) return standIn(group, kind, draw, wm);
  const fit = skywaysAddonFit(kind, sizeOf(gltf.scene));
  const shift = kind === 'skywaysConStage' ? new THREE.Matrix4().makeTranslation(0, 0, SKYWAYS_STAGE_MODEL_SHIFT * fit.k) : null;
  return instanceModel(group, gltf, draw.map(p => (shift ? placeM(p).multiply(shift) : placeM(p))), fit, kind);
}

/** QA: the Meshy model a kind renders (its measured real size). */
export const skywaysAddonModelSize = (kind: SkywaysAddonKind) => { const m = SKYWAYS_ADDON_MODEL[kind]; return m ? SKYWAYS_MESHY_PROPS[m] : null; };
