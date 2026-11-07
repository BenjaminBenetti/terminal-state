// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): draws the planted galleries' / courts' planter kinds
// (gen/skyways/destinations/kindsGardens.ts) — procedural planter bodies in the existing shape materials (precast concrete trough with
// a dark steel lip; timber-clad bench-planter with a slatted seat), a dark soil bed, and dense shrubs: the office's EXISTING potted-plant
// model (assets/companyAssets.ts 'potted-plant-small', lazy, requested by skywaysGardenModelKeysFor) scaled up and sunk so its pot sits
// below the soil line — only the foliage shows (no new model, no new texture). Without the model (not delivered / a test): a dark
// foliage stand-in box per shrub. Instanced per storey, named `prop-<kind>-<part>` (damage / physics find the nearest placement).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement, PropKind} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import {officeModelKey} from '../gen/office/kinds';
import {BENCH_PLANTER, GALLERY_PLANTER, GARDEN_SHRUBS, isSkywaysGardenKind, type GardenKind} from '../gen/skyways/destinations/kindsGardens';
import type {WorldMaterials} from './materials';
import {shapeMaterials} from './shapeMaterials';

type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: {w: number; h: number; d: number; anchor: 'bottom' | 'top'}, name: string) => number;

/** The foliage model (the office potted plant: natural size; `pot` = its bowl's rim as a fraction of its height, measured: the cut line). */
export const GARDEN_FOLIAGE = {key: officeModelKey('potted-plant-small'), w: 0.42, h: 0.6, d: 0.43, pot: 0.5} as const;

/** Game.sectionModelKeys: the foliage model when a layout placed a planter kind. */
export function skywaysGardenModelKeysFor(layout: {props?: readonly {kind: string}[]}): readonly string[] {
  return (layout.props ?? []).some(p => isSkywaysGardenKind(p.kind)) ? [GARDEN_FOLIAGE.key] : [];
}

interface Part { m: ShapeMat; s: [number, number, number]; p: [number, number, number] }

/** The planter body's parts (local frame: origin bottom centre, front +Z toward the walkway / seat side). */
export function gardenParts(kind: GardenKind): Part[] {
  if (kind === 'skyArchGalleryPlanter') {
    const P = GALLERY_PLANTER, wall = 0.05;
    return [
      {m: 'concrete', s: [P.w, P.h - P.lip, P.d], p: [0, (P.h - P.lip) / 2, 0]},
      // dark steel capping round the rim, the soil bed inside it
      {m: 'steelDark', s: [P.w, P.lip, wall], p: [0, P.h - P.lip / 2, P.d / 2 - wall / 2]},
      {m: 'steelDark', s: [P.w, P.lip, wall], p: [0, P.h - P.lip / 2, -P.d / 2 + wall / 2]},
      {m: 'steelDark', s: [wall, P.lip, P.d], p: [P.w / 2 - wall / 2, P.h - P.lip / 2, 0]},
      {m: 'steelDark', s: [wall, P.lip, P.d], p: [-P.w / 2 + wall / 2, P.h - P.lip / 2, 0]},
      {m: 'black', s: [P.w - 2 * wall, 0.02, P.d - 2 * wall], p: [0, P.soil, 0]},
    ];
  }
  const B = BENCH_PLANTER, slats = 4, gap = 0.012, sw = (B.seatD - (slats - 1) * gap) / slats;
  const parts: Part[] = [
    // timber-clad bed (the body under the seat and the planting)
    {m: 'wood', s: [B.w, B.h - B.seatT, B.d], p: [0, (B.h - B.seatT) / 2, 0]},
    // the rim round the bed (back and ends) and the soil
    {m: 'woodVeneer', s: [B.w, B.seatT, B.rim], p: [0, B.h - B.seatT / 2, -B.d / 2 + B.rim / 2]},
    {m: 'woodVeneer', s: [B.rim, B.seatT, B.d - B.seatD - B.rim], p: [B.w / 2 - B.rim / 2, B.h - B.seatT / 2, (B.seatD - B.rim) / -2 + 0.0]},
    {m: 'woodVeneer', s: [B.rim, B.seatT, B.d - B.seatD - B.rim], p: [-B.w / 2 + B.rim / 2, B.h - B.seatT / 2, (B.seatD - B.rim) / -2 + 0.0]},
    {m: 'black', s: [B.w - 2 * B.rim, 0.02, B.d - B.seatD - B.rim], p: [0, B.soil, -B.d / 2 + B.rim + (B.d - B.seatD - B.rim) / 2]},
  ];
  // the slatted seat along the front (slats along the bench, a slight overhang)
  for (let k = 0; k < slats; k++) parts.push({m: 'woodVeneer', s: [B.w + 0.04, B.seatT, sw], p: [0, B.h - B.seatT / 2, B.d / 2 + 0.02 - sw / 2 - k * (sw + gap)]});
  return parts;
}

/** Shrub spots in the planter's local frame (x, z, soil y) — deterministic per placement variant. */
export function shrubSpots(kind: GardenKind, variant: number): {x: number; z: number; y: number; rot: number; s: number}[] {
  const rnd = (k: number) => { const v = Math.sin((variant + 1) * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  const out: {x: number; z: number; y: number; rot: number; s: number}[] = [];
  if (kind === 'skyArchGalleryPlanter') {
    const n = GARDEN_SHRUBS.gallery, w = GALLERY_PLANTER.w;
    for (let i = 0; i < n; i++) out.push({x: -w / 2 + w * (i + 0.5) / n + (rnd(i) - 0.5) * 0.12, z: (rnd(i + 7) - 0.5) * 0.06, y: GALLERY_PLANTER.soil, rot: rnd(i + 3) * Math.PI * 2, s: 1 + (rnd(i + 11) - 0.5) * 2 * GARDEN_SHRUBS.jitter});
  } else {
    const B = BENCH_PLANTER, n = GARDEN_SHRUBS.bench, bed = B.w - 2 * B.rim, zc = -B.d / 2 + B.rim + (B.d - B.seatD - B.rim) / 2;
    for (let i = 0; i < n; i++) out.push({x: -bed / 2 + bed * (i + 0.5) / n + (rnd(i) - 0.5) * 0.15, z: zc + (rnd(i + 5) - 0.5) * 0.12, y: B.soil, rot: rnd(i + 3) * Math.PI * 2, s: 0.85 + (rnd(i + 11) - 0.5) * 2 * GARDEN_SHRUBS.jitter});
  }
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
const byLevel = <T extends {level?: number}>(list: readonly T[]) => {
  const m = new Map<number, T[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, mats: readonly {level: number; m: THREE.Matrix4}[], name: string): void {
  geo.computeBoundingSphere();
  for (const [level, list] of byLevel(mats.map(e => ({level: e.level, m: e.m})))) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, i) => im.setMatrixAt(i, e.m));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

let standInGeo: THREE.BufferGeometry | null = null;

const foliageCache = new WeakMap<GLTF, {geo: THREE.BufferGeometry; mat: THREE.Material}[]>();
/**
 * The foliage of the potted-plant model (local mesh separation, no new asset): every mesh fitted to the model's natural size (bottom
 * centre at the origin, as the builder fits a model) with the triangles wholly under the pot's rim (GARDEN_FOLIAGE.pot of its height:
 * the bowl and its soil) removed. Cached per loaded model (the library owns the source; these copies live as long as it).
 */
export function foliageParts(gltf: GLTF): {geo: THREE.BufferGeometry; mat: THREE.Material}[] {
  let out = foliageCache.get(gltf);
  if (out) return out;
  out = [];
  const F = GARDEN_FOLIAGE, root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const fit = new THREE.Matrix4().makeScale(F.w / size.x, F.h / size.y, F.d / size.z).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const cut = F.pot * F.h;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, mesh.matrixWorld));
    const pos = g.attributes.position, src = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({length: pos.count}, (_, i) => i);
    const keep: number[] = [];
    for (let t = 0; t + 2 < src.length; t += 3) if (Math.max(pos.getY(src[t]), pos.getY(src[t + 1]), pos.getY(src[t + 2])) > cut) keep.push(src[t], src[t + 1], src[t + 2]);
    // compact: only the vertices the kept triangles use (bounds / uploads of the foliage alone)
    const remap = new Map<number, number>(), order: number[] = [];
    const idx = keep.map(i => { let j = remap.get(i); if (j === undefined) { remap.set(i, (j = order.length)); order.push(i); } return j; });
    const f = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
      const arr = new Float32Array(order.length * a.itemSize);
      order.forEach((i, j) => { for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.getComponent(i, c); });
      f.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    f.setIndex(idx);
    f.computeBoundingSphere();
    g.dispose();
    out!.push({geo: f, mat: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material});
  });
  foliageCache.set(gltf, out);
  return out;
}

/** Renders one planter kind's placements (bodies + soil + shrubs). Returns the planter count. */
export function buildSkywaysGardenProp(group: THREE.Group, kind: PropKind, list: PropPlacement[], wm: WorldMaterials, instanceModel: InstanceModel,
  lib: Readonly<Record<string, GLTF | undefined>>): number {
  if (!isSkywaysGardenKind(kind) || !list.length) return 0;
  const pm = shapeMaterials(wm), byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of gardenParts(kind)) {
    const g = new THREE.BoxGeometry(...part.s);
    g.translate(...part.p);
    let l = byMat.get(part.m);
    if (!l) byMat.set(part.m, (l = []));
    l.push(g);
  }
  const at = list.map(p => ({level: p.level ?? 0, m: placeM(p)}));
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], at, `prop-${kind}-${m}`);
  }
  // shrubs: the foliage model sunk so its pot is under the soil (instanced once over every planter's shrubs)
  const F = GARDEN_FOLIAGE, S = GARDEN_SHRUBS.scale;
  const shrubs: {level: number; m: THREE.Matrix4}[] = [];
  for (const p of list) {
    const base = placeM(p);
    for (const s of shrubSpots(kind, p.variant)) {
      const k = S * s.s;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y - 0.03 - F.pot * F.h * k, s.z), new THREE.Quaternion().setFromAxisAngle(UP, s.rot), new THREE.Vector3(k, k, k));
      shrubs.push({level: p.level ?? 0, m: base.clone().multiply(local)});
    }
  }
  const gltf = lib[F.key];
  if (gltf) {
    // the model's foliage only (its bowl pot cut away: foliageParts), at its natural size; the per-shrub scale / sink in the matrices
    for (const part of foliageParts(gltf)) instanced(group, part.geo, part.mat, shrubs, `prop-${kind}-foliage`);
    void instanceModel;
  } else {
    // stand-in: a dark foliage box the size of the plant above its pot
    standInGeo ??= (() => { const g = new THREE.BoxGeometry(F.w * 0.9, F.h * (1 - F.pot), F.d * 0.9); g.translate(0, F.h * F.pot + F.h * (1 - F.pot) / 2, 0); return g; })();
    instanced(group, standInGeo, pm.black, shrubs, `prop-${kind}-foliage`);
  }
  return list.length;
}
