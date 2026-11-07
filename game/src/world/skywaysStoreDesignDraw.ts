// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): draws the LARCH & LOOM HOME store's two code-drawn kinds
// (gen/skyways/stores/kinds/design.ts): the vignette RUGS (skyDsRug: a field and a bound border band, sized per placement) and the
// folded THROW / TOWEL stacks on the textile tables (skyDsTextiles). Called by world/skywaysDestinations.ts buildSkywaysDestProp for
// these two kinds only (nothing changes for any other kind or level).
//
// Material: the Office architecture's CARPET floor material (world/officeArch.ts floorMaterial: the approved Codex office carpet
// texture T1 with its 30-year decay), one instance per colourway tint (DESIGN_TINT), re-valued per build; its carpet-tile seams and
// checker are turned off (one continuous pile). The boxes carry metre UVs at the office floor span, so the pile reads at the same
// scale as the office carpets. No new or hand-drawn texture.
//  - rugs: merged per (storey, tint) — flat, static, never shadow casters;
//  - textiles: instanced per (storey, variant, tint), named `prop-skyDsTextiles-…` so the prop render index (damage/propDamage.ts)
//    finds each stack's instance like every model prop (a stack knocked off its table moves with its body).
// Every mesh carries userData.level (the level culler).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import {DESIGN_TINT, designRugParts, designTextileParts, type DesignPart, type DesignTint, type StoreDesignKind} from '../gen/skyways/stores/kinds/design';
import {OFFICE_FLOOR_SPAN, floorMaterial, type OfficeSurfaceMaterial} from './officeArch';
import type {WorldMaterials} from './materials';

const DRAWN: ReadonlySet<string> = new Set<StoreDesignKind>(['skyDsRug', 'skyDsTextiles']);
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

/** Rugs: every rug of a storey merged per tint (world geometry; static, flat, receives shadows only). */
function drawRugs(group: THREE.Group, list: readonly PropPlacement[], wm: WorldMaterials): number {
  for (const [level, ps] of byLevel(list)) {
    const byTint = new Map<DesignTint, THREE.BufferGeometry[]>();
    for (const p of ps) {
      const turn = new THREE.Matrix4().makeRotationY(p.rot), at = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
      // (rugs are placed axis-aligned, rot 0: hx / hz are the world half extents; a quarter-turned one swaps them back)
      const q = Math.abs(Math.sin(p.rot)) > 0.7, hx = q ? p.hz : p.hx, hz = q ? p.hx : p.hz;
      for (const part of designRugParts(hx, hz, p.variant)) {
        const g = designBox(part.s, part.p).applyMatrix4(turn).applyMatrix4(at);
        let l = byTint.get(part.t);
        if (!l) byTint.set(part.t, (l = []));
        l.push(g);
      }
    }
    for (const [tint, geos] of byTint) {
      const mesh = new THREE.Mesh(merge(geos), designTextileMaterial(wm, tint));
      mesh.name = `prop-skyDsRug-${tint}`;
      mesh.userData.level = level;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.geometry.computeBoundingSphere();
      group.add(mesh);
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

/** Renders one of the design store's code-drawn kinds; returns the placements drawn. */
export function buildSkywaysStoreDesignProp(group: THREE.Group, kind: StoreDesignKind, list: PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  return kind === 'skyDsRug' ? drawRugs(group, list, wm) : drawTextiles(group, list, wm);
}
