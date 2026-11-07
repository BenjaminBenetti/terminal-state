// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): draws the LARCH & LOOM HOME store's own kinds
// (gen/skyways/stores/kinds/design.ts): the vignette RUGS (skyDsRug: a field and a bound border band, sized per placement), the
// folded THROW / TOWEL stacks on the textile tables (skyDsTextiles) and the FRAMED ART PRINTS (skyDsArtPrint: pale-oak frame and white
// mat as boxes in the shared shape materials, the art face one piece of the store's Codex print atlas — gen/skyways/stores/designArt.ts,
// loaded behind the loading screen by world/skywaysStoreDesignRuntime.ts; before / without it a plain board, never drawn art). Called
// by world/skywaysDestinations.ts buildSkywaysDestProp for these kinds only (nothing changes for any other kind or level).
//
// Material: the Office architecture's CARPET floor material (world/officeArch.ts floorMaterial: the approved Codex office carpet
// texture T1 with its 30-year decay), one instance per colourway tint (DESIGN_TINT), re-valued per build; its carpet-tile seams and
// checker are turned off (one continuous pile). The boxes carry metre UVs at the office floor span, so the pile reads at the same
// scale as the office carpets. No new or hand-drawn texture.
//  - rugs: one one-instance mesh per (rug, tint) — flat, static, never shadow casters;
//  - textiles: instanced per (storey, variant, tint), named `prop-skyDsTextiles-…` so the prop render index (damage/propDamage.ts)
//    finds each stack's instance like every model prop (a stack knocked off its table moves with its body).
// Every mesh carries userData.level (the level culler).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import {DESIGN_PRINT, DESIGN_TINT, designPrintArt, designPrintParts, designRugParts, designTextileParts, type DesignPart, type DesignTint, type StoreDesignKind} from '../gen/skyways/stores/kinds/design';
import {DESIGN_ART} from '../gen/skyways/stores/designArt';
import {OFFICE_FLOOR_SPAN, floorMaterial, type OfficeSurfaceMaterial} from './officeArch';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

const DRAWN: ReadonlySet<string> = new Set<StoreDesignKind>(['skyDsRug', 'skyDsTextiles', 'skyDsArtPrint']);
/** Is `kind` one of the design store's code-drawn kinds? */
export const isDesignDrawnKind = (kind: string): kind is StoreDesignKind => DRAWN.has(kind);

/** The textile material of a tint (the office carpet program, tinted; seams / tile checker off). Re-valued per call. */
export function designTextileMaterial(wm: WorldMaterials, tint: DesignTint): OfficeSurfaceMaterial {
  const hex = DESIGN_TINT[tint];
  const m = floorMaterial(wm, `store-design-textile-${tint}`, 'carpet', hex);
  // one continuous pile: carpet tiles 40 m (no seam inside a rug or a fold), no per-tile tone / checker step
  m.ofP.set(40, 40, 0, 0);
  m.ofQ.y = 0;
  return m;
}

/** A box (size s, centre p) with metre UVs at the office floor span on every face (the pile keeps one scale on any box). */
export function designBox(s: readonly [number, number, number], p: readonly [number, number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  const uv = g.attributes.uv as THREE.BufferAttribute, k = 1 / OFFICE_FLOOR_SPAN;
  // BoxGeometry faces in order +x, -x, +y, -y, +z, -z (4 vertices each): u / v span (z, y), (z, y), (x, z), (x, z), (x, y), (x, y)
  const span: readonly (readonly [number, number])[] = [[s[2], s[1]], [s[2], s[1]], [s[0], s[2]], [s[0], s[2]], [s[0], s[1]], [s[0], s[1]]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * span[f][0] * k, uv.getY(j) * span[f][1] * k); }
  g.translate(p[0], p[1], p[2]);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
const byLevel = (list: readonly PropPlacement[]) => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};
const merge = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  if (geos.length === 1) return geos[0];
  const g = mergeGeometries(geos, false);
  for (const q of geos) q.dispose();
  return g;
};

/**
 * Rugs: each rug its own geometry (its size: metre UVs) per tint — the field and the border band — drawn as a one-instance
 * InstancedMesh at the rug (so the prop render index maps each mesh to exactly its rug: a shot rug marks only itself). Static, flat,
 * receives shadows only. (~2 draws per rug; a store lays 3-11.)
 */
function drawRugs(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials): number {
  for (const p of list) {
    const turn = new THREE.Matrix4().makeRotationY(p.rot);
    // (rugs are placed axis-aligned, rot 0: hx / hz are the world half extents; a quarter-turned one swaps them back)
    const q = Math.abs(Math.sin(p.rot)) > 0.7, hx = q ? p.hz : p.hx, hz = q ? p.hx : p.hz;
    const byTint = new Map<DesignTint, THREE.BufferGeometry[]>();
    for (const part of designRugParts(hx, hz, p.variant)) {
      let l = byTint.get(part.t);
      if (!l) byTint.set(part.t, (l = []));
      l.push(designBox(part.s, part.p).applyMatrix4(turn));
    }
    for (const [tint, geos] of byTint) {
      const geo = merge(geos);
      geo.computeBoundingSphere();
      const im = new THREE.InstancedMesh(geo, designTextileMaterial(wm, tint), 1);
      im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      im.name = `prop-skyDsRug-${tint}`;
      im.userData.level = p.level ?? 0;
      im.castShadow = false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  return list.length;
}

/** Textile stacks: one merged geometry per (variant, tint), instanced on the stacks of that variant per storey. */
function drawTextiles(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials): number {
  for (const [level, ps] of byLevel(list)) {
    const byVariant = new Map<number, PropPlacement[]>();
    for (const p of ps) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
    for (const [variant, vs] of byVariant) {
      const byTint = new Map<DesignTint, DesignPart[]>();
      for (const part of designTextileParts(variant)) { const l = byTint.get(part.t); if (l) l.push(part); else byTint.set(part.t, [part]); }
      for (const [tint, parts] of byTint) {
        const geo = merge(parts.map(part => designBox(part.s, part.p)));
        geo.computeBoundingSphere();
        const im = new THREE.InstancedMesh(geo, designTextileMaterial(wm, tint), vs.length);
        vs.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
        im.name = `prop-skyDsTextiles-v${variant}-${tint}`;
        im.userData.level = level;
        im.castShadow = false;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      }
    }
  }
  return list.length;
}

// ---------------------------------------------------------------------------------------------
// Framed prints

let artMat: THREE.Material | null = null;
let plainBoard: THREE.Material | null = null;
/** The runtime hands in the print atlas material (null: forget it). */
export function setDesignArtMaterial(m: THREE.Material | null): void { artMat = m; }
/** The print atlas material, or the plain board stand-in when the atlas is not loaded (never drawn art). */
export function designArtMaterial(): THREE.Material {
  if (artMat) return artMat;
  if (!plainBoard) { plainBoard = new SurfaceNodeMaterial({color: 0xe6e1d6, roughness: 0.85, metalness: 0}); plainBoard.name = 'store-design-print-plain'; }
  return plainBoard;
}
/** Does the print art show (QA / tests)? */
export const designArtLoaded = (): boolean => artMat !== null;

/** The art face of a print variant: its atlas piece on a quad over the mat (prop frame). */
export function designPrintFace(variant: number): THREE.BufferGeometry {
  const {w, h} = designPrintArt(), P = DESIGN_PRINT, n = DESIGN_ART.pieces.length;
  const r = DESIGN_ART.pieces[((Math.trunc(variant) % n) + n) % n];
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  g.translate(0, P.h / 2, -P.d / 2 + 0.0095);
  return g;
}

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): void {
  geo.computeBoundingSphere();
  for (const [level, ps] of byLevel(list)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

/** Prints: frame bars / mat merged per shape material, one art quad per variant (the atlas piece). */
function drawPrints(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials): number {
  const pm = shapeMaterials(wm), byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of designPrintParts()) {
    const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]).translate(part.p[0], part.p[1], part.p[2]);
    let l = byMat.get(part.m);
    if (!l) byMat.set(part.m, (l = []));
    l.push(g);
  }
  for (const [m, geos] of byMat) instanced(group, merge(geos), pm[m], list, `prop-skyDsArtPrint-${m}`);
  const byVariant = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
  for (const [variant, ps] of byVariant) instanced(group, designPrintFace(variant), designArtMaterial(), ps, `prop-skyDsArtPrint-art${variant}`);
  return list.length;
}

/** Renders one of the design store's own kinds; returns the placements drawn. */
export function buildSkywaysStoreDesignProp(group: THREE.Group, kind: StoreDesignKind, list: PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  return kind === 'skyDsRug' ? drawRugs(group, list, wm) : kind === 'skyDsTextiles' ? drawTextiles(group, list, wm) : drawPrints(group, list, wm);
}
