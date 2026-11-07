// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-GARDEN): draws the Glasshouse Garden Co.'s two code-drawn kinds
// (gen/skyways/stores/kinds/garden.ts: box parts in the existing shape materials, no model / art file) — called by
// world/skywaysDestinations.ts buildSkywaysDestProp for these kinds only (one tagged hook line there).
//  - storeGardenSoilPallet: the pallet + bag parts merged per material, instanced per storey; the bags' `accent` body takes the
//    placement variant's bag colour (InstancedMesh colours: compost green / potting-soil brown / mulch black).
//  - storeGardenBasketRail: the rail / hook / hanger parts, plus its two suspension rods drawn from the rail straight up to the ceiling
//    over each rod (the placement's storey grid; no ceiling recorded: no rod) — render only, like the destination kits' cables.
// Every mesh: `prop-<kind>-<suffix>` and userData.level (the level culler), like the other destination kinds.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {BASKET_RAIL, BASKET_RAIL_PARTS, BASKET_ROD, SOIL_BAG_COLORS, SOIL_PALLET_PARTS, isStoreGardenKind, type GardenPart, type GardenPartMat} from '../gen/skyways/stores/kinds/garden';
import {shapeMaterials} from './shapeMaterials';
import type {WorldMaterials} from './materials';

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

/** Is this one of the garden store's code-drawn kinds (drawn here, not by the destination model path)? */
export const isStoreGardenDrawn = (kind: string): boolean => isStoreGardenKind(kind);

function partGeo(part: GardenPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
  if (part.rx) g.rotateX(part.rx);
  g.translate(part.p[0], part.p[1], part.p[2]);
  return g;
}

/** One InstancedMesh per storey; `color` (optional) tints each instance. */
function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly {m: THREE.Matrix4; level: number; color?: number}[], name: string): void {
  geo.computeBoundingSphere();
  const byLevel = new Map<number, typeof list[number][]>();
  for (const e of list) { const l = byLevel.get(e.level); if (l) l.push(e); else byLevel.set(e.level, [e]); }
  for (const [level, es] of byLevel) {
    const im = new THREE.InstancedMesh(geo, mat, es.length);
    const c = new THREE.Color();
    es.forEach((e, i) => { im.setMatrixAt(i, e.m); if (e.color !== undefined) im.setColorAt(i, c.setHex(e.color, THREE.SRGBColorSpace)); });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

/** The parts merged per material, instanced on the placements (accent parts tinted by `tint`). */
function drawParts(group: THREE.Group, kind: string, parts: readonly GardenPart[], list: readonly PropPlacement[], wm: WorldMaterials, tint?: (p: PropPlacement) => number): void {
  const pm = shapeMaterials(wm), byMat = new Map<GardenPartMat, THREE.BufferGeometry[]>();
  for (const part of parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(partGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], list.map(p => ({m: placeM(p), level: p.level ?? 0, ...(m === 'accent' && tint ? {color: tint(p)} : {})})), `prop-${kind}-${m}`);
  }
}

/** The basket rails' rods: from each rod point on the rail top straight up to the ceiling over it (none where no ceiling is recorded). */
export function basketRailRods(p: PropPlacement, layout: Pick<StationLayout, 'levels' | 'grid'> | undefined): {x: number; y: number; z: number; len: number}[] {
  const g = layout?.levels?.[p.level ?? 0]?.grid ?? layout?.grid;
  if (!g) return [];
  const c = Math.cos(p.rot), s = Math.sin(p.rot), y0 = p.y + BASKET_RAIL.railY + BASKET_RAIL.pipe, out: {x: number; y: number; z: number; len: number}[] = [];
  for (const ox of BASKET_RAIL.rods) {
    const x = p.x + ox * c, z = p.z - ox * s, ceil = g.ceilAt(x, z);
    const len = Number.isFinite(ceil) ? Math.min(BASKET_ROD.maxLen, ceil - y0) : 0;
    if (len >= 0.05) out.push({x, y: y0, z, len});
  }
  return out;
}

/** Draws a garden kind's placements; returns the instance count. */
export function drawStoreGarden(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number {
  if (!list.length) return 0;
  if (kind === 'storeGardenSoilPallet') {
    drawParts(group, kind, SOIL_PALLET_PARTS, list, wm, p => SOIL_BAG_COLORS[((p.variant % SOIL_BAG_COLORS.length) + SOIL_BAG_COLORS.length) % SOIL_BAG_COLORS.length]);
    return list.length;
  }
  if (kind === 'storeGardenBasketRail') {
    drawParts(group, kind, BASKET_RAIL_PARTS, list, wm);
    const rods: {m: THREE.Matrix4; level: number}[] = [];
    for (const p of list) for (const r of basketRailRods(p, layout)) rods.push({level: p.level ?? 0, m: new THREE.Matrix4().makeTranslation(r.x, r.y, r.z).multiply(new THREE.Matrix4().makeScale(1, r.len, 1))});
    if (rods.length) {
      const geo = new THREE.BoxGeometry(BASKET_ROD.t, 1, BASKET_ROD.t);
      geo.translate(0, 0.5, 0);
      instanced(group, geo, shapeMaterials(wm).steelBright, rods, `prop-${kind}-rod`);
    }
    return list.length;
  }
  return 0;
}
