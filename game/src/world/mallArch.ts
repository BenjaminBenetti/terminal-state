// Task track3-eaton-centre-20261031 (lane ARCH): The Eaton's Center architecture — the mall's finishes and its atrium.
//
// Reference (reference/viewing-notes.md, TEC-3-level-shot): a long galleria under a barrel-vaulted GLASS roof on white steel
// arch trusses; stacked retail galleries with glass balustrades + steel handrails on the void edge; white round columns with
// dark tile bands; bridges with glass sides; escalator banks; an exposed steel-frame glass elevator tower; hanging banners;
// warm shopfronts with fascia signs and blade signs; a concentric-ring terrazzo plaza at the bottom of the pit.
//
// 1. FINISHES (the builder's mall branches ask MallArch, exactly like OfficeArch for the office storeys; the Subway and the
//    Office never reach this module): every wall / floor / ceiling of the mall resolves to a finish of world/mallFinishes.ts —
//    per-program shop finishes, ring-tinted gallery terrazzo, the plaza rings, slab fascias, back-of-house block — written as a
//    per-vertex FINISH ROW into ONE material per surface kind (world/mallSurfaces.ts; front / back of house differ only in the
//    decay profile). Keys: 'mall-wall|<row>', 'mall-wall-boh|<row>', 'mall-floor[-boh]|<row>', 'mall-ceil[-boh]|<row>'; the
//    builder's accumulators split the row off the key (world/builder.ts Accum.fin). The station storey keeps its subway finishes
//    except the plaza courts (concentric rings) and the atrium fascias. Over the void no opaque ceiling is drawn (the glass vault).
// 2. ATRIUM (buildAtrium, into the station group before the warm-up, tagged for the level culler): the glass barrel vault with a
//    glazing-bar grid (transparent: never a flashlight shadow caster — markShadows skips transparent materials — and the
//    skylight bake treats it as transmissive), white steel arch trusses + purlins + edge girders, glazed gable fans, a roof deck
//    ring outside the glass and an overcast sky dome seen through it; glass balustrades + stainless handrails on every ring rail
//    run (GEN's railing collision is unchanged); white columns with dark tile bands outboard of the balustrades; the glass /
//    steel elevator shaft tower; shopfront fascia signs + projecting blade signs (canvas brand graphics per program, fictional
//    brands from layout.mall.shops, aged), Level labels on the void fascias; hanging banners in the void; square downlight cans
//    for the ring fixtures (the baked light set is unchanged); escalator truss soffits under the open escalators.
// Draw cost is bounded: merged per material and per storey (and per 48 m chunk for the long balustrade runs); one sign atlas.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu';
import {abs, cameraPosition, clamp, dot, float, floor, fract, max, min, mix, normalWorld, normalize, positionWorld, smoothstep, step, uv, vec2, vec3} from 'three/tsl';
import {CELL, FLOOR, SOLID, VOID, rampHeight} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {MallInfo, MallProgram, MallShop} from '../gen/mall/mallTypes';
import {canvasTexture} from './canvasTextures';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, surfaceMaterial, thinTrim, type WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';
import {SIGN_ATLAS_CONTEXT, wmHash} from './surfaceNodes';
import {CHUNK_M, RAIL_HEIGHT, cellCeil, type RailRun} from './levelGeometry';
import {ATRIUM_MARGIN} from './levelCulling';
import {
  GALLERY_FLOOR, PLAZA_FLOOR, PROGRAM_FINISH, SPACE_FINISH, bohClass, bohFinish, stockFinish,
  type MallCeilFinish, type MallFinishSet, type MallFloorFinish, type MallSpace, type MallWallFinish,
} from './mallFinishes';
import {MALL_FINISH_ATTR, MALL_SPAN, ceilRow, floorRow, mallSurfaceMaterial, wallRow, writeRow, MALL_TABLE_ROWS} from './mallSurfaces';
import {mallTowerRecord} from '../gen/mall/elevator'; // the glass elevator's door side (lane GEN derives it; never re-derived here)
import {cutOfficeShaftDoors} from './officeProps'; // task mall-playtest-revision (U07): the same landing-doorway cut as the Office
import {GLASS_RIG} from './elevator';
import {MALL_EXT_ORDER, buildMallExteriorGas, hazeSat, mallSkyMaterial} from './mallExterior'; // task mall-playtest-revision (U02)
import {adTexture, adsOf, planGalleryAds, type AdWall, type MallAd} from './mallAds'; // task mall-playtest-revision (D06)
import {FOUNTAIN, PYLON} from '../gen/mall/landmarks'; // landmark dimensions (placement: gen/mall/landmarks.ts)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Split a mall surface key ('mall-wall|12') into its material key and finish row (-1: not a row key). */
export function splitFinishKey(k: string): {base: string; row: number} {
  const bar = k.indexOf('|');
  return bar < 0 ? {base: k, row: -1} : {base: k.slice(0, bar), row: Number(k.slice(bar + 1))};
}

const isMallKey = (k: string) => k.startsWith('mall-');

// ---------------------------------------------------------------------------------------------------------------------------
// Dressing materials (once per WorldMaterials)

export interface MallDressMaterials {
  glassRoof: THREE.Material; glassRail: THREE.Material; whiteSteel: THREE.Material; stainless: THREE.Material; darkSteel: THREE.Material;
  columnRender: THREE.Material; columnTile: THREE.Material; membrane: THREE.Material; sky: THREE.Material; can: THREE.Material;
  trimLight: THREE.Material; trimDark: THREE.Material; trimWood: THREE.Material; soffit: THREE.Material;
  /** The pit-plaza fountain: dark granite basin, pale stone coping, stagnant water, verdigris bronze centrepiece. */
  fountainStone: THREE.Material; fountainCoping: THREE.Material; fountainWater: THREE.Material; fountainBronze: THREE.Material;
}
const dressCache = new WeakMap<WorldMaterials, MallDressMaterials>();

/** Distance (in pane units) to the nearest pane edge of a unit grid at q. */
const edge01 = (q: AnyNode): AnyNode => { const f = fract(q) as AnyNode; return min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())); };

/**
 * Roof glazing: unlit (it is lit from outside: the toxic murk behind it), transparent, double-sided. UVs are metres (u along the
 * vault, v around the arch): glazing bars every 1.5 x 1.2 m (opaque), panes tinted with the Office's murk colour (world/mallExterior.ts
 * hazeSat: it never lays a pale film over the dark green sky), a third of them grimy (30 years of dirt, darker), ~5 % broken out (open
 * to the sky), grazing views more opaque (fresnel). Task mall-playtest-revision (U02, primary's browser check): it WRITES DEPTH, so the
 * screen-space interior haze (render/volumetric.ts: marched up to the scene depth, lit by the skylight) stops at the glass instead of
 * laying a bright grey veil over the exterior beyond it; the exterior sky / gas draw before it (renderOrder) and every other glass is
 * in front of it — still transparent, so never a flashlight shadow caster.
 */
function roofGlass(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: true, side: THREE.DoubleSide});
  m.name = 'mall-glass-roof';
  const U = (uv() as AnyNode).div(vec2(1.5, 1.2));
  const cell = floor(U) as AnyNode;
  const e = edge01(U);
  const bar = float(1).sub(smoothstep(0.018, 0.035, e));
  const r = wmHash(vec3(cell.x, cell.y, 61)) as AnyNode;
  const broken = step(r, 0.05);
  const grime = smoothstep(0.55, 0.95, r).mul(0.32);
  const v = normalize(cameraPosition.sub(positionWorld) as AnyNode);
  const fres = float(1).sub(abs(dot(normalize(normalWorld as AnyNode), v))).pow(3);
  const murk = hazeSat() as AnyNode;
  const pane = mix(murk.mul(1.7), murk.mul(1.05), grime.mul(2.2));
  m.colorNode = mix(pane, vec3(0.62, 0.64, 0.6), bar);
  m.opacityNode = clamp(max(bar.mul(0.96), float(0.12).add(grime).add(fres.mul(0.3)).mul(float(1).sub(broken))), 0, 1);
  m.userData.mallGlass = 'roof';
  return m;
}

/** Balustrade / shaft glazing: unlit, faint green-grey, darker and denser toward the panel edges and at grazing angles. */
function railGlass(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide});
  m.name = 'mall-glass-rail';
  const U = uv() as AnyNode;
  const e = min(min(U.x, U.x.oneMinus()), min(U.y, U.y.oneMinus()));
  const edge = float(1).sub(smoothstep(0.0, 0.04, e));
  const v = normalize(cameraPosition.sub(positionWorld) as AnyNode);
  const fres = float(1).sub(abs(dot(normalize(normalWorld as AnyNode), v))).pow(2.5);
  m.colorNode = mix(vec3(0.08, 0.11, 0.1), vec3(0.16, 0.24, 0.21), edge);
  m.opacityNode = clamp(float(0.1).add(edge.mul(0.35)).add(fres.mul(0.38)), 0, 0.85);
  m.userData.mallGlass = 'rail';
  return m;
}

/** The mall's dressing materials (shared per WorldMaterials; every one in the scene before the warm-up). */
export function mallDressMaterials(mats: WorldMaterials): MallDressMaterials {
  let d = dressCache.get(mats);
  if (d) return d;
  const named = <M extends THREE.Material>(m: M, name: string): M => { m.name = name; return m; };
  d = {
    glassRoof: roofGlass(),
    glassRail: railGlass(),
    whiteSteel: named(thinTrim(surfaceMaterial('paintedSteel', {color: 0xe9e9e4, metalness: 0.15}, {grime: [0.12, 0.5], macro: 0.08})), 'mall-white-steel'),
    stainless: shapeMaterial(mats, 'kitchenSteel'),
    darkSteel: named(thinTrim(surfaceMaterial('paintedSteel', {color: 0x3a3d40, metalness: 0.35}, {grime: [0.2, 0.5], macro: 0.12})), 'mall-dark-steel'),
    columnRender: named(surfaceMaterial('paintedPanel', {color: 0xeeece6, roughness: 1}, {grime: [0.35, 0.9], macro: 0.08}), 'mall-column-render'),
    columnTile: named(surfaceMaterial('shopTile', {color: 0x3a3c40, roughness: 1}, {grime: [0.2, 0.5], macro: 0.12}), 'mall-column-tile'),
    membrane: named(surfaceMaterial('paintedPanel', {color: 0x4a4b48, roughness: 1}, {macro: 0.2}), 'mall-roof-deck'),
    sky: mallSkyMaterial(), // task mall-playtest-revision (U02): the Office's exterior murk (world/mallExterior.ts)
    can: named(surfaceMaterial('paintedPanel', {color: 0xdedcd6, roughness: 1}, {macro: 0.05}), 'mall-downlight-can'),
    trimLight: named(thinTrim(surfaceMaterial('paintedPanel', {color: 0xd8d6d0, roughness: 1}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-light'),
    trimDark: named(thinTrim(surfaceMaterial('paintedSteel', {color: 0x2e3032, metalness: 0.3}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-dark'),
    trimWood: named(thinTrim(surfaceMaterial('woodVeneer', {color: 0xc8a888, roughness: 1}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-wood'),
    soffit: named(surfaceMaterial('paintedPanel', {color: 0xe6e4de, roughness: 1}, {macro: 0.06}), 'mall-escalator-soffit'),
    fountainStone: named(surfaceMaterial('black', {color: 0x6a6a6c, roughness: 0.55}, {grime: [0.4, 0.4], macro: 0.15}), 'mall-fountain-stone'),
    fountainCoping: named(surfaceMaterial('porcelain', {color: 0xcdc4b2, roughness: 0.7}, {grime: [0.3, 0.3], macro: 0.12}), 'mall-fountain-coping'),
    fountainWater: named(new SurfaceNodeMaterial({map: stagnantWaterTexture(), roughness: 0.12, metalness: 0}), 'mall-fountain-water'),
    fountainBronze: named(surfaceMaterial('brushedSteel', {color: 0x6f8f74, metalness: 0.45}, {grime: [0.3, 0.6], macro: 0.25}), 'mall-fountain-bronze'),
  };
  dressCache.set(mats, d);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry accumulation

/** Merged triangles with normals and UVs (counter-clockwise toward the normal). */
class Mesher {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  get empty(): boolean { return !this.idx.length; }
  /** Quad p0..p3 (any winding: fixed to face `n`), uv per corner. */
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const d = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
    const order = d < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const b = this.pos.length / 3;
    for (const i of order) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[i][0], uv[i][1]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Both faces of a quad (glass panels). */
  quad2(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    this.quad(p, n, uv);
    this.quad(p, [-n[0], -n[1], -n[2]], uv);
  }
  tri(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const b = this.pos.length / 3;
    for (let i = 0; i < 3; i++) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[i][0], uv[i][1]); }
    this.idx.push(b, b + 1, b + 2);
  }
  /** Append an indexed / non-indexed BufferGeometry (positions, normals, uvs). */
  add(g: THREE.BufferGeometry): void {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const b = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(b + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(b + i);
    g.dispose();
  }
  /** Box between two points (square-ish cross-section t x t2). */
  beam(a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const g = new THREE.BoxGeometry(t, t2, len);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.add(g);
  }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(cx, cy, cz);
    this.add(g);
  }
  cyl(x: number, y0: number, z: number, r: number, h: number, seg = 16): void {
    const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
    // world-mapped materials ignore these UVs; keep u around, v up in metres for face-UV ones
    g.translate(x, y0 + h / 2, z);
    this.add(g);
  }
  mesh(mat: THREE.Material, name: string, tag: {level?: number; levels?: readonly number[]}): THREE.Mesh | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    if (tag.levels && tag.levels.length) m.userData.levels = [...tag.levels];
    else if (tag.level !== undefined) m.userData.level = tag.level;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Brand signage (canvas, fictional brands; one atlas)

/** Sign style per program: background, text, accent colour, typeface, pictogram. */
export interface BrandStyle { bg: string; fg: string; accent: string; font: 'sans' | 'serif' | 'condensed' | 'rounded' | 'mono'; icon: string }
export const BRAND_STYLE: Record<MallProgram, BrandStyle> = {
  guns: {bg: '#1b1c1d', fg: '#e8e2d2', accent: '#c8452e', font: 'condensed', icon: 'crosshair'},
  outdoors: {bg: '#2e3a2a', fg: '#efe6cf', accent: '#d9a441', font: 'serif', icon: 'peak'},
  pharmacy: {bg: '#f2f4f2', fg: '#1e6e58', accent: '#2fa37f', font: 'sans', icon: 'cross'},
  clinic: {bg: '#e8f0f4', fg: '#1f4d66', accent: '#d23c3c', font: 'sans', icon: 'cross'},
  electronics: {bg: '#16181c', fg: '#e8f6fa', accent: '#2ac0e0', font: 'mono', icon: 'bolt'},
  phone: {bg: '#f4f4f2', fg: '#202224', accent: '#e0702a', font: 'rounded', icon: 'phone'},
  hardware: {bg: '#d29a1e', fg: '#1a1a1a', accent: '#1a1a1a', font: 'condensed', icon: 'wrench'},
  clothing: {bg: '#e9e1d4', fg: '#3a2a1e', accent: '#a47a50', font: 'serif', icon: 'hanger'},
  shoes: {bg: '#222224', fg: '#f2f0ea', accent: '#d8c8a8', font: 'sans', icon: 'shoe'},
  department: {bg: '#1e2a3a', fg: '#efe8d8', accent: '#c8a45a', font: 'serif', icon: 'star'},
  'food-court': {bg: '#b03a2e', fg: '#fff4e0', accent: '#f2c14e', font: 'rounded', icon: 'fork'},
  cafe: {bg: '#3a2618', fg: '#f4e6cc', accent: '#c88a4a', font: 'serif', icon: 'cup'},
  grocery: {bg: '#3e6a3a', fg: '#f4f2e0', accent: '#e8c84a', font: 'rounded', icon: 'leaf'},
  books: {bg: '#2f4a3c', fg: '#f0e6cc', accent: '#c8a050', font: 'serif', icon: 'book'},
  toys: {bg: '#3a7fc1', fg: '#fff8e0', accent: '#e8c547', font: 'rounded', icon: 'star'},
  sports: {bg: '#23304a', fg: '#ffffff', accent: '#c8323a', font: 'condensed', icon: 'ball'},
  jewelry: {bg: '#141312', fg: '#e8d8a8', accent: '#b8963e', font: 'serif', icon: 'gem'},
  home: {bg: '#a9b79a', fg: '#2a3226', accent: '#f0ece2', font: 'serif', icon: 'house'},
  beauty: {bg: '#f2dcd8', fg: '#6a3a3a', accent: '#c8a08a', font: 'serif', icon: 'drop'},
  music: {bg: '#141416', fg: '#efe6ff', accent: '#9a5ad8', font: 'condensed', icon: 'note'},
  pet: {bg: '#3e8a80', fg: '#f4fff8', accent: '#f2c46a', font: 'rounded', icon: 'paw'},
  arcade: {bg: '#0e0e14', fg: '#ff6ad0', accent: '#2ad0d8', font: 'mono', icon: 'star'},
  luggage: {bg: '#4e3a2a', fg: '#f0e4d0', accent: '#c8a070', font: 'sans', icon: 'case'},
  optical: {bg: '#f4f6f8', fg: '#2c4a6a', accent: '#2c4a6a', font: 'sans', icon: 'glasses'},
  florist: {bg: '#5a8a5a', fg: '#fff6f0', accent: '#e88aa0', font: 'serif', icon: 'flower'},
  kiosk: {bg: '#6a5a42', fg: '#f4ecdc', accent: '#e8d0a0', font: 'sans', icon: 'info'},
  service: {bg: '#2c3a46', fg: '#eef2f4', accent: '#8ab0c8', font: 'sans', icon: 'info'},
  vacant: {bg: '#cfccc4', fg: '#4a4844', accent: '#8a8680', font: 'sans', icon: 'none'},
};

const FONT: Record<BrandStyle['font'], string> = {
  sans: '"Helvetica Neue", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', condensed: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  rounded: '"Trebuchet MS", "Helvetica Neue", Arial, sans-serif', mono: '"Courier New", monospace',
};

/** Draws a program pictogram centred at (x, y), size s. */
function drawIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, s: number, col: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ctx.fillStyle = col;
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.lineCap = 'round';
  const r = s / 2;
  const P = () => ctx.beginPath();
  switch (icon) {
    case 'crosshair': P(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.stroke(); for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { P(); ctx.moveTo(a * r * 0.3, b * r * 0.3); ctx.lineTo(a * r, b * r); ctx.stroke(); } break;
    case 'peak': P(); ctx.moveTo(-r, r * 0.7); ctx.lineTo(-r * 0.2, -r * 0.6); ctx.lineTo(r * 0.2, 0); ctx.lineTo(r * 0.5, -r * 0.3); ctx.lineTo(r, r * 0.7); ctx.closePath(); ctx.fill(); break;
    case 'cross': ctx.fillRect(-r * 0.25, -r * 0.8, r * 0.5, r * 1.6); ctx.fillRect(-r * 0.8, -r * 0.25, r * 1.6, r * 0.5); break;
    case 'bolt': P(); ctx.moveTo(r * 0.2, -r); ctx.lineTo(-r * 0.5, r * 0.15); ctx.lineTo(0, r * 0.15); ctx.lineTo(-r * 0.2, r); ctx.lineTo(r * 0.5, -r * 0.15); ctx.lineTo(0, -r * 0.15); ctx.closePath(); ctx.fill(); break;
    case 'phone': ctx.strokeRect(-r * 0.45, -r * 0.85, r * 0.9, r * 1.7); ctx.fillRect(-r * 0.12, r * 0.6, r * 0.24, r * 0.1); break;
    case 'wrench': P(); ctx.moveTo(-r * 0.7, r * 0.7); ctx.lineTo(r * 0.3, -r * 0.3); ctx.stroke(); P(); ctx.arc(r * 0.45, -r * 0.45, r * 0.35, 0.8, Math.PI * 2 - 0.8); ctx.stroke(); break;
    case 'hanger': P(); ctx.moveTo(-r, r * 0.5); ctx.lineTo(0, -r * 0.2); ctx.lineTo(r, r * 0.5); ctx.closePath(); ctx.stroke(); P(); ctx.arc(0, -r * 0.5, r * 0.25, Math.PI, Math.PI * 2.4); ctx.stroke(); break;
    case 'shoe': P(); ctx.moveTo(-r, r * 0.5); ctx.lineTo(-r, -r * 0.4); ctx.lineTo(-r * 0.3, -r * 0.4); ctx.lineTo(r, r * 0.1); ctx.lineTo(r, r * 0.5); ctx.closePath(); ctx.fill(); break;
    case 'star': P(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); break;
    case 'fork': for (const dx of [-0.25, 0, 0.25]) { P(); ctx.moveTo(dx * r - r * 0.3, -r); ctx.lineTo(dx * r - r * 0.3, -r * 0.2); ctx.stroke(); } P(); ctx.moveTo(-r * 0.3, -r * 0.2); ctx.lineTo(-r * 0.3, r); ctx.stroke(); P(); ctx.moveTo(r * 0.5, -r); ctx.quadraticCurveTo(r * 0.9, -r * 0.2, r * 0.5, 0); ctx.lineTo(r * 0.5, r); ctx.stroke(); break;
    case 'cup': ctx.fillRect(-r * 0.6, -r * 0.3, r * 1.0, r * 0.9); P(); ctx.arc(r * 0.45, r * 0.1, r * 0.25, -Math.PI / 2, Math.PI / 2); ctx.stroke(); break;
    case 'leaf': P(); ctx.ellipse(0, 0, r * 0.45, r * 0.9, 0.6, 0, Math.PI * 2); ctx.fill(); break;
    case 'book': ctx.fillRect(-r * 0.8, -r * 0.6, r * 0.75, r * 1.2); ctx.fillRect(r * 0.05, -r * 0.6, r * 0.75, r * 1.2); break;
    case 'ball': P(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.stroke(); P(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 0.8); ctx.stroke(); break;
    case 'gem': P(); ctx.moveTo(-r * 0.8, -r * 0.2); ctx.lineTo(-r * 0.4, -r * 0.7); ctx.lineTo(r * 0.4, -r * 0.7); ctx.lineTo(r * 0.8, -r * 0.2); ctx.lineTo(0, r * 0.8); ctx.closePath(); ctx.fill(); break;
    case 'house': P(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(0, -r * 0.8); ctx.lineTo(r * 0.8, 0); ctx.closePath(); ctx.fill(); ctx.fillRect(-r * 0.55, 0, r * 1.1, r * 0.75); break;
    case 'drop': P(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.8, r * 0.1, 0, r * 0.8); ctx.quadraticCurveTo(-r * 0.8, r * 0.1, 0, -r); ctx.fill(); break;
    case 'note': P(); ctx.arc(-r * 0.3, r * 0.5, r * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-r * 0.05, -r * 0.8, r * 0.14, r * 1.3); ctx.fillRect(-r * 0.05, -r * 0.8, r * 0.6, r * 0.2); break;
    case 'paw': P(); ctx.ellipse(0, r * 0.35, r * 0.42, r * 0.34, 0, 0, Math.PI * 2); ctx.fill(); for (const [dx, dy] of [[-0.55, -0.15], [-0.2, -0.55], [0.2, -0.55], [0.55, -0.15]]) { P(); ctx.arc(dx * r, dy * r, r * 0.17, 0, Math.PI * 2); ctx.fill(); } break;
    case 'case': ctx.fillRect(-r * 0.8, -r * 0.35, r * 1.6, r * 1.1); ctx.strokeRect(-r * 0.3, -r * 0.7, r * 0.6, r * 0.35); break;
    case 'glasses': for (const dx of [-0.45, 0.45]) { P(); ctx.arc(dx * r, 0, r * 0.32, 0, Math.PI * 2); ctx.stroke(); } P(); ctx.moveTo(-r * 0.13, 0); ctx.lineTo(r * 0.13, 0); ctx.stroke(); break;
    case 'flower': for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; P(); ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.3, 0, Math.PI * 2); ctx.fill(); } break;
    case 'info': P(); ctx.arc(0, -r * 0.6, r * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-r * 0.12, -r * 0.3, r * 0.24, r * 1.0); break;
    default: break;
  }
  ctx.restore();
}

/** Aged brand fascia sign (canvas): brand name, pictogram, accent rule; grime gradient, a faded patch, a dropped letter. */
export function brandSignTexture(brand: string, program: MallProgram, seed: number, w = 768, h = 120): THREE.CanvasTexture {
  const st = BRAND_STYLE[program];
  return canvasTexture(w, h, seed, (ctx, cw, ch, rnd) => {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, cw, ch);
    const text = program === 'vacant' ? 'AVAILABLE · FOR LEASE' : brand;
    const icon = st.icon !== 'none';
    const iconS = ch * 0.62;
    ctx.fillStyle = st.accent;
    ctx.fillRect(0, ch - ch * 0.08, cw, ch * 0.04);
    let size = Math.round(ch * 0.5);
    const font = () => `${st.font === 'serif' ? '' : 'bold '}${size}px ${FONT[st.font]}`;
    ctx.font = font();
    const avail = cw - 60 - (icon ? iconS + 30 : 0);
    while (ctx.measureText(text).width > avail && size > 20) { size -= 2; ctx.font = font(); }
    const tw = ctx.measureText(text).width;
    const total = tw + (icon ? iconS + 30 : 0);
    let x = (cw - total) / 2;
    if (icon) { drawIcon(ctx, st.icon, x + iconS / 2, ch * 0.46, iconS, st.accent); x += iconS + 30; }
    ctx.fillStyle = st.fg;
    ctx.textBaseline = 'middle';
    // one letter dropped out (a missing channel letter) on about a third of the signs
    const drop = rnd() < 0.35 ? Math.floor(rnd() * text.length) : -1;
    let cx = x;
    for (let i = 0; i < text.length; i++) {
      const ch1 = text[i];
      const lw = ctx.measureText(ch1).width;
      if (i !== drop || ch1 === ' ') ctx.fillText(ch1, cx, ch * 0.46);
      else { ctx.save(); ctx.globalAlpha = 0.18; ctx.fillText(ch1, cx, ch * 0.46); ctx.restore(); }
      cx += lw;
    }
    // 30 years: grime from the top edge, streaks, a sun-faded patch
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, 'rgba(40,34,26,0.45)'); g.addColorStop(0.35, 'rgba(40,34,26,0.12)'); g.addColorStop(1, 'rgba(40,34,26,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(30,26,20,${0.05 + rnd() * 0.12})`; ctx.fillRect(rnd() * cw, 0, 1 + rnd() * 4, ch * (0.3 + rnd() * 0.7)); }
    ctx.fillStyle = `rgba(240,236,228,${0.06 + rnd() * 0.1})`;
    ctx.fillRect(rnd() * cw * 0.7, 0, cw * (0.15 + rnd() * 0.25), ch);
  });
}

/** Square blade sign (program pictogram over the brand initials) for the projecting signs. */
function bladeSignTexture(brand: string, program: MallProgram, seed: number): THREE.CanvasTexture {
  const st = BRAND_STYLE[program];
  return canvasTexture(128, 128, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = st.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = st.accent; ctx.lineWidth = 4; ctx.strokeRect(5, 5, w - 10, h - 10);
    if (st.icon !== 'none') drawIcon(ctx, st.icon, w / 2, h * 0.4, h * 0.42, st.accent);
    const words = (program === 'vacant' ? 'TO LET' : brand).split(/\s+/).filter(Boolean);
    const init = words.length > 1 ? words.slice(0, 3).map(s => s[0]).join('').toUpperCase() : (words[0] ?? '').slice(0, 6).toUpperCase();
    ctx.fillStyle = st.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 26; ctx.font = `bold ${size}px ${FONT[st.font]}`;
    while (ctx.measureText(init).width > w - 20 && size > 10) { size -= 1; ctx.font = `bold ${size}px ${FONT[st.font]}`; }
    ctx.fillText(init, w / 2, h * 0.8);
    ctx.fillStyle = `rgba(40,34,26,${0.18 + rnd() * 0.2})`; ctx.fillRect(0, 0, w, h);
  });
}

/** Storey label for the void fascias ('LEVEL 3'). */
function levelLabelTexture(label: string, ring: number): THREE.CanvasTexture {
  return canvasTexture(384, 120, 9100 + ring, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#2a2c2e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9a520'; ctx.beginPath(); ctx.arc(h * 0.5, h * 0.5, h * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1f2225'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.5)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(String(ring), h * 0.5, h * 0.53);
    ctx.fillStyle = '#ece4cf'; ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(h * 0.42)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(label.toUpperCase(), h * 1.05, h * 0.53);
    ctx.fillStyle = `rgba(40,34,26,${0.15 + rnd() * 0.15})`; ctx.fillRect(0, 0, w, h);
  });
}

/**
 * Hanging banner (vertical, torn foot: alpha cut-out): the mall's name or a faded event. Task mall-playtest-revision (U01 render):
 * the name is the layout's seeded "<Name> Center" (layout.mall.name), the counts the real ones — never a literal.
 */
function bannerTexture(i: number, name: string, floors: number, shops: number): THREE.CanvasTexture {
  const words = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
  const nm = name.toUpperCase();
  const texts = [nm, 'SPRING · SALE', `${words[floors] ?? floors} LEVELS · ${shops} SHOPS`, 'OPEN LATE', nm, 'GRAND REOPENING'];
  const cols = [['#8a1f24', '#f2e8d8'], ['#1f3a5a', '#f2e8d8'], ['#2e4a32', '#efe4c8'], ['#3a2a4a', '#f0e2f2']];
  const [bg, fg] = cols[i % cols.length];
  return canvasTexture(256, 1024, 9300 + i, (ctx, w, h, rnd) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    // torn, ragged foot (transparent below)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0);
    let y = h * (0.86 + rnd() * 0.08);
    ctx.lineTo(w, y);
    for (let x = w; x >= 0; x -= 16) { y = h * (0.8 + rnd() * 0.17); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(w / 2, h * 0.42); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 120; ctx.font = `bold ${size}px Georgia, serif`;
    const t = texts[i % texts.length];
    while (ctx.measureText(t).width > h * 0.72 && size > 30) { size -= 4; ctx.font = `bold ${size}px Georgia, serif`; }
    ctx.fillText(t, 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, w, h * 0.12);
    for (let k = 0; k < 30; k++) { ctx.fillStyle = `rgba(20,18,14,${0.05 + rnd() * 0.15})`; ctx.fillRect(rnd() * w, rnd() * h * 0.8, 2 + rnd() * 10, 4 + rnd() * 60); }
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The builder's view of the mall

interface FaceLike {
  level: number; area: number; finish: string; x0: number; z0: number; x1: number; z1: number; nx: number; nz: number;
  y0: number; y1: number; openings: {s0: number; s1: number; top: number}[]; slope?: unknown; vb0?: number; vb1?: number;
}

/** A mall space of an area on a grid level (finish resolution). */
interface SpaceInfo { space: MallSpace; ring: number; program?: MallProgram; shop?: MallShop }

/** Atrium statistics (QA / tests / render-cost report). */
export interface AtriumStats {
  meshes: number; triangles: number; roofPanes: number; arches: number; balustradeM: number; balustradeRuns: number; columns: number;
  signs: number; blades: number; labels: number; banners: number; downlights: number; shaftPanels: number; soffits: number; droppedFaces: number;
  /** Shopfront props drawn (lane SHOPS' collision-only glazing / closed shutters) and visual-only partial shutters. */
  glazing: number; shutters: number; partialShutters: number;
  /** Landmarks drawn (gen/mall/landmarks.ts): fountains and directory pylons. */
  fountains: number; pylons: number;
  /** Task mall-playtest-revision (U02): exterior gas layers drawn over / round the glass roof; the curtain's opacity (= the Office
   *  fog's opacity at its distance). */
  exteriorGas: number; exteriorCurtain: number;
  /** Flat glazing (m²) over the part of the top opening outside the vault. */
  flatGlazingM2: number;
  /** D06: ad faces drawn (lane SHOPS' records / ARCH's gallery billboards). */
  shopAds: number; galleryAds: number;
  /** Build time of the atrium dressing (ms). */
  ms: number;
}

export class MallArch {
  readonly info: MallInfo;
  /** Level index of the pit bottom (the station) and the ring level ids. */
  readonly floorLevel: number;
  /** Per cell of the pit-bottom grid: 1 = a void column (its band rises to the roof). */
  readonly voidCol: Uint8Array;
  /**
   * Per cell: 1 = inside the void outline (the atrium: open on the pit-bottom storey; bridges / escalators may cross it higher up).
   * The level culler's atrium tiles and the fascia / soffit finishes use it.
   */
  readonly atrium: Uint8Array;
  /**
   * Task mall-playtest-revision-20261031 (lane ARCH): per cell, 1 = under the glazed roof (inside MallRoof.polygon — the TOP
   * atrium opening — else the roof outline): no ceiling there; a band rising to the roof there gets the slab-edge / roof-edge
   * treatment whatever storey it belongs to (the openings widen upward: the jutting galleries of floors 1-2 are open to the glass).
   */
  readonly roofCell: Uint8Array;
  private readonly W: number;
  private readonly H: number;
  private readonly galleryAreas = new Set<number>();
  private readonly bridgeAreas = new Set<number>();
  private readonly shopByArea = new Map<number, MallShop>();
  private readonly stockByArea = new Map<number, MallShop>();
  private readonly plazaCenter = new Map<number, {x: number; z: number}>();
  /** Finish rows by signature. */
  private readonly rows = new Map<string, number>();
  private nextRow = 0;
  private readonly floorCache = new Map<number, string | null>();
  /** D06: gallery billboard candidate walls (collected by remapFaces). */
  private readonly adWalls: AdWall[] = [];
  /** D06: the ads drawn by the last buildAtrium (lane SHOPS' records + ARCH's gallery billboards). */
  ads: MallAd[] = [];
  readonly dress: MallDressMaterials;
  stats: AtriumStats = {meshes: 0, triangles: 0, roofPanes: 0, arches: 0, balustradeM: 0, balustradeRuns: 0, columns: 0, signs: 0, blades: 0, labels: 0, banners: 0, downlights: 0, shaftPanels: 0, soffits: 0, droppedFaces: 0, glazing: 0, shutters: 0, partialShutters: 0, fountains: 0, pylons: 0, exteriorGas: 0, exteriorCurtain: 0, flatGlazingM2: 0, shopAds: 0, galleryAds: 0, ms: 0};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): MallArch | null {
    return layout.mall ? new MallArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    const info = layout.mall!;
    this.info = info;
    this.floorLevel = info.void.floorLevel ?? 0;
    const g0 = levels[0].grid;
    this.W = g0.w; this.H = g0.h;
    for (const g of info.galleries) for (const a of g.areas) this.galleryAreas.add(a);
    for (const b of info.bridges) this.bridgeAreas.add(b.area);
    for (const s of info.shops) { this.shopByArea.set(s.area, s); if (s.backroom !== undefined && s.backroom >= 0) this.stockByArea.set(s.backroom, s); }
    // void columns: cells of the pit-bottom grid whose band rises to (near) the roof spring
    const n = this.W * this.H, spring = info.roof.springY;
    this.voidCol = new Uint8Array(n);
    const gf = this.gridOf(this.floorLevel);
    this.atrium = new Uint8Array(n);
    this.roofCell = new Uint8Array(n);
    // the atrium = the union of every storey's opening (task mall-playtest-revision: v2 openings are nested, widening upward, so
    // the union is the top opening; v1 = the one outline): the level culler's atrium tiles join every band rising in it
    const polys: {poly: readonly {x: number; z: number}[]; b: {x0: number; z0: number; x1: number; z1: number}}[] = [{poly: info.void.outline, b: info.void.bounds}];
    for (const o of info.void.openings ?? []) if (o.outline.length >= 3) polys.push({poly: o.outline, b: o.bounds});
    const rp = info.roof.polygon && info.roof.polygon.length >= 3 ? info.roof.polygon : null, ro = info.roof.outline;
    if (rp) polys.push({poly: rp, b: ro});
    for (let i = 0; i < n; i++) {
      const cx = i % this.W, cy = (i - cx) / this.W, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      if (x >= ro.x0 - 0.01 && x <= ro.x1 + 0.01 && z >= ro.z0 - 0.01 && z <= ro.z1 + 0.01 && (!rp || pointInPoly(rp, x, z))) this.roofCell[i] = 1;
      if (polys.some(({poly, b}) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && (poly.length < 3 || pointInPoly(poly, x, z)))) this.atrium[i] = 1;
      const c = gf.cells[i];
      if (c !== FLOOR && c !== VOID) continue;
      if (gf.rampIdx[i] < 0 && cellCeil(gf, i) >= spring - 0.5) this.voidCol[i] = 1;
    }
    // plaza courts: public, non-platform areas of the pit-bottom storey near the void (their own ring centre each)
    const vb = info.void.bounds, pad = 10;
    for (const a of layout.areas) {
      if ((a.level ?? 0) !== levels[this.floorLevel]?.id || !a.publicSpace || a.kind === 'platform' || this.shopByArea.has(a.id) || this.galleryAreas.has(a.id)) continue;
      const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
      if (x1 < vb.x0 - pad || x0 > vb.x1 + pad || z1 < vb.z0 - pad || z0 > vb.z1 + pad) continue;
      this.plazaCenter.set(a.id, {x: (x0 + x1) / 2, z: (z0 + z1) / 2});
    }
    // the concentric rings of the court holding the fountain (gen/mall/landmarks.ts) centre on it: every plaza area of that court
    const fountain = layout.props.find(p => p.kind === 'fountainBasin');
    if (fountain) {
      const lab = layout.areas[fountain.area]?.label;
      for (const id of [...this.plazaCenter.keys()]) if (layout.areas[id]?.label === lab) this.plazaCenter.set(id, {x: fountain.x, z: fountain.z});
    }
    this.dress = mallDressMaterials(mats);
  }

  private gridOf(level: number) { return (this.levels.find(l => l.id === level) ?? this.levels[0]).grid; }
  /** Ring number of a level id (0 = the station). */
  ringOf(level: number): number {
    const s = this.info.storeys.find(q => q.level === level);
    return s ? (s.role === 'ring' ? s.level : 0) : Math.max(0, level);
  }
  private storeyOf(level: number) { return this.info.storeys.find(q => q.level === level); }

  /** The mall space of an area as seen from grid level `level`. */
  spaceOf(areaId: number, level: number): SpaceInfo {
    const ring = this.ringOf(level);
    const a = areaId >= 0 ? this.layout.areas[areaId] : undefined;
    const shop = this.shopByArea.get(areaId);
    if (shop) return {space: 'shop', ring, program: shop.program, shop};
    const stock = this.stockByArea.get(areaId);
    if (stock) return {space: 'stock', ring, program: stock.program, shop: stock};
    if (this.galleryAreas.has(areaId)) return {space: 'gallery', ring};
    if (this.bridgeAreas.has(areaId)) return {space: 'bridge', ring};
    if (level === this.floorLevel || (a && (a.level ?? 0) === this.floorLevel)) return {space: this.plazaCenter.has(areaId) ? 'plaza' : 'station', ring: 0};
    if (a?.publicSpace) {
      const c = bohClass(a);
      return {space: c === 'wash' ? 'wash' : 'gallery', ring};
    }
    return {space: bohClass(a), ring};
  }

  /** The finish set of a space (shop programs, gallery, back of house). */
  finishOf(sp: SpaceInfo): MallFinishSet {
    const S = SPACE_FINISH;
    switch (sp.space) {
      case 'shop': return PROGRAM_FINISH[sp.program ?? 'vacant'];
      case 'stock': return stockFinish(sp.program ?? 'vacant');
      case 'gallery': return {wall: S.galleryWall, floor: GALLERY_FLOOR[Math.min(GALLERY_FLOOR.length - 1, sp.ring)], ceil: S.galleryCeil};
      case 'bridge': return {wall: S.galleryWall, floor: S.bridgeFloor, ceil: S.galleryCeil};
      case 'plaza': return {wall: S.galleryWall, floor: PLAZA_FLOOR, ceil: S.galleryCeil};
      default: return bohFinish(sp.space);
    }
  }

  /**
   * Back-of-house geometry deeper than the atrium culling margin goes into its own accumulator per side of the void ('~dN' ...;
   * the same material): its meshes then have tight boxes beyond ATRIUM_MARGIN and stay culled when the void is seen from another
   * storey (a corridor loop merged with the stock rooms in one 48 m chunk would always be within the margin).
   */
  private deepTag(x: number, z: number): string {
    const b = this.info.void.bounds;
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
    // per axis: a '~dN' mesh's whole box then lies MALL_DEEP beyond the void in z (the culler's margin test is per axis)
    if (Math.max(dx, dz) < MALL_DEEP) return '';
    return dz >= dx ? (z < b.z0 ? '~dN' : '~dS') : (x < b.x0 ? '~dW' : '~dE');
  }

  private static boh(sp: SpaceInfo): boolean { return sp.space === 'stock' || sp.space === 'corridor' || sp.space === 'core' || sp.space === 'wash' || sp.space === 'plant'; }

  /** Table row of a finish (allocated once per distinct finish of this build). */
  private row(kind: 'w' | 'f' | 'c', f: MallWallFinish | MallFloorFinish | MallCeilFinish, center?: {x: number; z: number}): number {
    const sig = `${kind}:${JSON.stringify(f)}${center ? `@${center.x},${center.z}` : ''}`;
    let r = this.rows.get(sig);
    if (r !== undefined) return r;
    r = this.nextRow < MALL_TABLE_ROWS ? this.nextRow++ : MALL_TABLE_ROWS - 1;
    writeRow(r, kind === 'w' ? wallRow(f as MallWallFinish) : kind === 'f' ? floorRow(f as MallFloorFinish, center) : ceilRow(f as MallCeilFinish));
    this.rows.set(sig, r);
    return r;
  }

  private wallKey(sp: SpaceInfo, fascia = false, f?: {x0: number; z0: number; x1: number; z1: number}): string {
    if (fascia) return `mall-wall|${this.row('w', SPACE_FINISH.fascia)}`;
    const boh = MallArch.boh(sp);
    // a face is deep only when BOTH ends are deep on the same side (a wall running toward the void keeps its near end)
    const t0 = boh && f ? this.deepTag(f.x0, f.z0) : '', tag = t0 && this.deepTag(f!.x1, f!.z1) === t0 ? t0 : '';
    return `mall-wall${boh ? `-boh${tag}` : ''}|${this.row('w', this.finishOf(sp).wall)}`;
  }

  /**
   * Whether the open cell in front of a face (plane + normal * CELL / 2) is a band rising to the glazed roof: the station's atrium
   * column, or (task mall-playtest-revision: openings widening upward) a retail floor's jutting gallery open to the roof. Its faces
   * are slab edges (white fascias) and, above the top floor, the roof-edge beam under the clerestory.
   */
  private bandFront(f: FaceLike): boolean {
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const mx = alongX ? (f.x0 + f.x1) / 2 : f.x0 + f.nx * CELL / 2;
    const mz = alongX ? f.z0 + f.nz * CELL / 2 : (f.z0 + f.z1) / 2;
    const cx = Math.floor(mx / CELL), cy = Math.floor(mz / CELL);
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return false;
    const i = cy * this.W + cx;
    if (!this.atrium[i] && !this.roofCell[i]) return false;
    const g = this.gridOf(f.level), c = g.cells[i];
    if (c !== FLOOR && c !== VOID) return false;
    return cellCeil(g, i) >= this.info.roof.springY - 0.5;
  }

  /**
   * The side ('N' | 'S' | 'E' | 'W') of an elevator shaft a face lies on (its plane on the shaft rect boundary, its span inside
   * that side), else null.
   */
  private shaftSide(f: FaceLike): 'N' | 'S' | 'E' | 'W' | null {
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    for (const e of this.info.elevators) {
      const s = e.shaft, t = 0.02;
      if (alongX) {
        if (Math.min(f.x0, f.x1) >= s.x0 - t && Math.max(f.x0, f.x1) <= s.x1 + t) { if (Math.abs(f.z0 - s.z0) < t) return 'N'; if (Math.abs(f.z0 - s.z1) < t) return 'S'; }
      } else if (Math.min(f.z0, f.z1) >= s.z0 - t && Math.max(f.z0, f.z1) <= s.z1 + t) { if (Math.abs(f.x0 - s.x0) < t) return 'W'; if (Math.abs(f.x0 - s.x1) < t) return 'E'; }
    }
    return null;
  }

  /** The glass sides of the shaft: every side but the landing-door side (lane GEN's mallTowerRecord doorSide). */
  private glassSides(): Set<string> {
    if (!this.glassSideCache) {
      const rec = mallTowerRecord(this.layout) as {elevator?: {doorSide?: string}} | null;
      const door = rec?.elevator?.doorSide ?? null;
      this.glassSideCache = new Set(['N', 'S', 'E', 'W'].filter(sd => sd !== door));
    }
    return this.glassSideCache;
  }
  private glassSideCache: Set<string> | null = null;

  /**
   * Task mall-playtest-revision-20261031 (lane ARCH, U07: "there is a wall where the door should be, and you can walk through the
   * wall when the door is open"). Cause: the landing-door side of the shaft kept its full wall face on every storey (only the glass
   * sides were dropped) while the cab's Levels gate opened the collision through those solid cells — a painted wall you could walk
   * through. The Office cuts its doorways in cutOfficeShaftDoors (world/officeProps.ts, layout.office only); the mall now feeds the
   * SAME cut its glass-elevator record (gen/mall/elevator.ts mallTowerRecord): door width x SHAFT_DOOR_H (= LIFT_DOOR_H = the gate's
   * clear height) above every stop, so the open doorway is a real aperture (linings, landing leaves, the cab) and the shut landing
   * leaves fill it — the visual matches the gate.
   */
  private cutShaftDoors<F extends FaceLike>(faces: F[]): F[] {
    const rec = mallTowerRecord(this.layout) as {elevator?: unknown} | null;
    if (!rec?.elevator) return faces;
    return cutOfficeShaftDoors(faces, {office: rec} as unknown as Parameters<typeof cutOfficeShaftDoors>[1]);
  }

  /** A face on a glass side of the shaft (dropped: the glass shaft tower replaces it). */
  private onShaft(f: FaceLike): boolean {
    const sd = this.shaftSide(f);
    return sd !== null && this.glassSides().has(sd);
  }

  /**
   * Mall finishes for the builder's wall faces: ring storeys by space (gallery white render, per-program shop walls, back of
   * house), atrium faces of the void band (slab edges, bridge sides) as white fascias clipped at the roof springing line,
   * atrium-facing elevator shaft walls dropped (the glass shaft tower replaces them). Station-storey faces outside the atrium
   * keep their subway finishes.
   */
  remapFaces<F extends FaceLike>(faces: F[], tileLowerHeight: number): F[] {
    const out: F[] = [];
    const spring = this.info.roof.springY;
    for (const f of this.cutShaftDoors(faces)) {
      const isFloor = f.level === this.floorLevel;
      const up = /tileUpper/.test(f.finish) && f.vb0 !== undefined ? {vb0: f.vb0 - tileLowerHeight, vb1: (f.vb1 ?? f.vb0) - tileLowerHeight} : {};
      if (this.onShaft(f)) { this.stats.droppedFaces++; continue; }
      if (this.bandFront(f)) {
        if (isFloor && f.y1 <= 3.0) { out.push(f); continue; } // the platform edge / bed walls under the atrium: the station's own
        // above the top floor: a white roof-edge beam, then the glazed clerestory up to the springing line and the roof (buildRoof)
        const beamTop = this.topRingCeil + ROOF_BEAM;
        if (f.y0 >= beamTop - 0.02 || f.y0 >= spring - 0.02) { this.stats.droppedFaces++; continue; }
        const y1 = Math.min(f.y1, f.y0 >= this.topRingCeil - 0.05 ? beamTop : spring + 0.05);
        out.push({...f, finish: this.wallKey({space: 'gallery', ring: 0}, true), y1, vb0: f.y0, vb1: f.y0, openings: f.openings.filter(o => o.top > f.y0)});
        continue;
      }
      const a = f.area >= 0 ? this.layout.areas[f.area] : undefined;
      const sp = this.spaceOf(f.area, f.level);
      if (sp.space === 'station') { out.push(f); continue; }
      // D06: long opening-free public walls (courts, corridors, the plaza) are gallery billboard candidates
      if ((sp.space === 'plaza' || sp.space === 'gallery') && !f.slope && Math.hypot(f.x1 - f.x0, f.z1 - f.z0) >= 3.8) {
        this.adWalls.push({level: f.level, x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, nx: f.nx, nz: f.nz, y0: f.y0, y1: f.y1, ops: f.openings.map(o => ({s0: o.s0, s1: o.s1}))});
      }
      if (sp.space === 'plaza') { out.push({...f, finish: this.wallKey(sp), ...up}); continue; }
      // stair flight side walls: public flights white, service flights the core
      const space: SpaceInfo = f.slope ? (a?.publicSpace ? {space: 'gallery', ring: sp.ring} : {space: 'core', ring: sp.ring}) : sp;
      out.push({...f, finish: this.wallKey(space, false, f), ...up});
    }
    return out;
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule, the station storey outside the plaza). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const id = lvl.grid.area[i];
    const ck = lvl.id * 1048576 + id + 1;
    let k = this.floorCache.get(ck);
    if (k === undefined) {
      const sp = this.spaceOf(id, lvl.id);
      if (sp.space === 'station') k = null;
      else if (sp.space === 'plaza') k = `mall-floor|${this.row('f', PLAZA_FLOOR, this.plazaCenter.get(id))}`;
      else k = `mall-floor${MallArch.boh(sp) ? '-boh' : ''}|${this.row('f', this.finishOf(sp).floor)}`;
      this.floorCache.set(ck, k);
    }
    // the plaza rings never paint the track bed / platform cells under the atrium
    if (k && lvl.id === this.floorLevel && lvl.grid.cells[i] === VOID) return null;
    if (k && k.startsWith('mall-floor-boh|')) {
      const cx = i % this.W, cy = (i - cx) / this.W, tag = this.deepTag((cx + 0.5) * CELL, (cy + 0.5) * CELL);
      if (tag) return k.replace('-boh|', `-boh${tag}|`);
    }
    return k;
  }

  /** Ceiling key of a run (null: builder rule; false: none — the glass vault over the void). */
  ceilKey(L: number, areaId: number, i?: number, y?: number): string | false | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const spring = this.info.roof.springY;
    if (i !== undefined) {
      const top = y ?? cellCeil(lvl.grid, i);
      if (top >= spring - 0.5 && this.roofCell[i]) return false;
    }
    if (lvl.id === this.floorLevel && i !== undefined && this.atrium[i]) return `mall-ceil|${this.row('c', SPACE_FINISH.galleryCeil)}`; // bridge soffits over the pit
    const sp = this.spaceOf(areaId, lvl.id);
    if (sp.space === 'station') return null;
    const boh = MallArch.boh(sp);
    const tag = boh && i !== undefined ? this.deepTag((i % this.W + 0.5) * CELL, (Math.floor(i / this.W) + 0.5) * CELL) : '';
    return `mall-ceil${boh ? `-boh${tag}` : ''}|${this.row('c', this.finishOf(sp).ceil)}`;
  }

  /** Soffit of a door opening (null: station rule). */
  doorCeilKey(L: number, a: Area | undefined, b: Area | undefined): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const sa = this.spaceOf(a?.id ?? -1, lvl.id), sb = this.spaceOf(b?.id ?? -1, lvl.id);
    if (sa.space === 'station' && sb.space === 'station') return null;
    const boh = MallArch.boh(sa) && MallArch.boh(sb);
    return `mall-ceil${boh ? '-boh' : ''}|${this.row('c', boh ? SPACE_FINISH.bohCeil : SPACE_FINISH.galleryCeil)}`;
  }

  /** Door frame trim (null: the station's steel). */
  doorTrimKey(level: number, a: Area | undefined): string | null {
    const sp = this.spaceOf(a?.id ?? -1, level);
    if (sp.space === 'station') return null;
    if (sp.space === 'shop' && sp.program && /clothing|books|home|cafe|outdoors|luggage/.test(sp.program)) return 'mall-trim-wood';
    return MallArch.boh(sp) ? 'mall-trim-dark' : 'mall-trim-light';
  }

  /** Texture scale (m per repeat) of a mall key; undefined for any other key. */
  scale(key: string): {u: number; v: number} | undefined {
    if (!isMallKey(key)) return undefined;
    if (key.startsWith('mall-trim')) return {u: 1, v: 1};
    return {u: MALL_SPAN, v: MALL_SPAN};
  }

  /** The material behind a mall key; undefined for any other key. */
  material(key: string): THREE.Material | undefined {
    if (!isMallKey(key)) return undefined;
    const base = splitFinishKey(key).base.replace(/~d[NSEW]$/, '');
    switch (base) {
      case 'mall-wall': return mallSurfaceMaterial('wall');
      case 'mall-wall-boh': return mallSurfaceMaterial('wall', true);
      case 'mall-floor': return mallSurfaceMaterial('floor');
      case 'mall-floor-boh': return mallSurfaceMaterial('floor', true);
      case 'mall-ceil': return mallSurfaceMaterial('ceiling');
      case 'mall-ceil-boh': return mallSurfaceMaterial('ceiling', true);
      case 'mall-trim-light': return this.dress.trimLight;
      case 'mall-trim-dark': return this.dress.trimDark;
      case 'mall-trim-wood': return this.dress.trimWood;
      default: return undefined;
    }
  }

  /** Architecture mesh name of a mall key ('mall-arch-wall', ...). */
  meshName(key: string): string | undefined {
    if (!isMallKey(key)) return undefined;
    const base = splitFinishKey(key).base;
    return `mall-arch-${base.replace(/~d[NSEW]$/, '').slice(5)}${/~d[NSEW]$/.test(base) ? '-deep' : ''}`;
  }

  /** Rail runs ARCH draws as glass balustrades (every ring storey run); the station storey keeps the steel guard rail. */
  ownsRail(r: RailRun): boolean {
    return r.level !== this.floorLevel && r.kind !== 'parapet';
  }

  /** Light fixtures drawn as square downlight cans (ring storeys); the station storey keeps its tube fixtures. */
  isDownlight(l: {level?: number}): boolean {
    return (l.level ?? 0) !== this.floorLevel;
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // Atrium

  /** All level ids (the roof, columns, sky render with every storey). */
  private get allLevels(): number[] { return this.levels.map(l => l.id); }

  /** Builds the atrium architecture and dressing into `group` (before the warm-up). Returns its stats. */
  buildAtrium(group: THREE.Group, rails: readonly RailRun[]): AtriumStats {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const add = (m: THREE.Mesh | null) => {
      if (!m) return;
      group.add(m);
      this.stats.meshes++;
      this.stats.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    };
    for (const fn of [
      () => this.buildRoof(add), () => this.buildBalustrades(add, rails), () => this.buildColumns(add), () => this.buildShaftTowers(add),
      () => this.buildSignage(group, add), () => this.buildBanners(add), () => this.buildEscalatorSoffits(add), () => this.buildShopfronts(add, this.mats),
      () => this.buildFountain(add), () => this.buildAds(group, add),
    ]) {
      try { fn(); } catch (e) { console.warn('mall atrium: part skipped', e); }
    }
    this.stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return this.stats;
  }

  /** Top of the building around the void: the highest ring's clear height (its roof slab underside). */
  private get topRingCeil(): number {
    const tops = this.info.storeys.filter(s => s.role === 'ring').map(s => s.baseY + s.clear);
    return tops.length ? Math.max(...tops) : this.info.roof.springY - 1;
  }

  /** The atrium opening of a retail floor (v2 void.openings; v1 / unknown: the floor-1 void outline). */
  openingOf(level: number): readonly {x: number; z: number}[] {
    const o = this.info.void.openings?.find(q => q.level === level);
    return o && o.outline.length >= 3 ? o.outline : this.info.void.outline;
  }

  /**
   * The glazed outline of the roof: MallRoof.polygon (task mall-playtest-revision: the TOP atrium opening — glass only over the
   * atrium), else (v1 records) the floor-1 void outline under the roof outline's vault.
   */
  roofPolygon(): readonly {x: number; z: number}[] {
    const p = this.info.roof.polygon;
    return p && p.length >= 3 ? p : this.info.void.outline;
  }

  /**
   * The barrel vault's footprint: the largest axis-aligned rectangle of glazed cells (v2: inside the roof polygon; the rest of the
   * polygon is flat glazing at the springing line), else (v1) the roof outline.
   */
  vaultRect(): {x0: number; z0: number; x1: number; z1: number} {
    if (this.vaultCache) return this.vaultCache;
    const R = this.info.roof;
    let v = {...R.outline};
    if (R.polygon && R.polygon.length >= 3) {
      const cx0 = Math.max(0, Math.floor(R.outline.x0 / CELL)), cy0 = Math.max(0, Math.floor(R.outline.z0 / CELL));
      const cx1 = Math.min(this.W, Math.ceil(R.outline.x1 / CELL)), cy1 = Math.min(this.H, Math.ceil(R.outline.z1 / CELL));
      const r = maxRect(cx1 - cx0, cy1 - cy0, (x, y) => this.roofCell[(cy0 + y) * this.W + cx0 + x] === 1);
      if (r) v = {x0: (cx0 + r.x0) * CELL, z0: (cy0 + r.y0) * CELL, x1: (cx0 + r.x1) * CELL, z1: (cy0 + r.y1) * CELL};
    }
    return (this.vaultCache = v);
  }
  private vaultCache: {x0: number; z0: number; x1: number; z1: number} | null = null;

  /**
   * The glass roof (task mall-playtest-revision: over the TOP atrium opening only): a barrel vault over its largest rectangle (glass
   * panes, white steel arch trusses, purlins, edge girders, glazed gable fans), flat glazing on light steel rafters over the rest of
   * the opening at the springing line, the clerestory on every edge of the opening from the roof-edge beam up to the springing line,
   * the building's roof deck outside it, the sky (the Office's exterior murk) and the toxic gas drifting outside (U02).
   */
  private buildRoof(add: (m: THREE.Mesh | null) => void): void {
    const R = this.info.roof, o = this.vaultRect();
    const alongX = o.x1 - o.x0 >= o.z1 - o.z0;
    const L0 = alongX ? o.x0 : o.z0, L1 = alongX ? o.x1 : o.z1;
    const A0 = alongX ? o.z0 : o.x0, A1 = alongX ? o.z1 : o.x1;
    const half = (A1 - A0) / 2, mid = (A0 + A1) / 2, rise = Math.max(1, R.apexY - R.springY);
    const P = (l: number, a: number, y: number): [number, number, number] => (alongX ? [l, y, a] : [a, y, l]);
    const V = (l: number, a: number, y: number) => new THREE.Vector3(...P(l, a, y));
    const SEG = 18;
    // elliptical arch: across t in [-1, 1], height spring + rise * sqrt(1 - t^2)
    const arc = (k: number) => { const th = Math.PI * k / SEG; return {a: mid - Math.cos(th) * half, y: R.springY + Math.sin(th) * rise}; };
    const glass = new Mesher(), steel = new Mesher(), deck = new Mesher();
    // arc length along the profile (v in metres)
    const sAt: number[] = [0];
    for (let k = 1; k <= SEG; k++) { const p = arc(k - 1), q = arc(k); sAt.push(sAt[k - 1] + Math.hypot(q.a - p.a, q.y - p.y)); }
    const bays = Math.max(1, Math.round((L1 - L0) / Math.max(2, R.archSpacing)));
    const bay = (L1 - L0) / bays;
    for (let b = 0; b < bays; b++) {
      const la = L0 + b * bay, lb = la + bay;
      for (let k = 0; k < SEG; k++) {
        const p = arc(k), q = arc(k + 1);
        const mx = (p.a + q.a) / 2 - mid, my = (p.y + q.y) / 2 - R.springY;
        const nA = -(mx / (half * half)), nY = -(my / (rise * rise)); // inward normal of the ellipse
        const nn = Math.hypot(nA, nY) || 1;
        const n = alongX ? [0, nY / nn, nA / nn] : [nA / nn, nY / nn, 0];
        glass.quad([P(la, p.a, p.y), P(lb, p.a, p.y), P(lb, q.a, q.y), P(la, q.a, q.y)], n, [[la, sAt[k]], [lb, sAt[k]], [lb, sAt[k + 1]], [la, sAt[k + 1]]]);
        this.stats.roofPanes++;
      }
    }
    // steel arch trusses at every bay line: outer chord at the glass, inner chord 0.7 m inside, lattice diagonals
    const depth = Math.min(0.9, rise * 0.15);
    const inner = (k: number) => { const th = Math.PI * k / SEG; return {a: mid - Math.cos(th) * (half - depth), y: R.springY + Math.sin(th) * Math.max(0.3, rise - depth)}; };
    for (let b = 0; b <= bays; b++) {
      const l = L0 + b * bay;
      for (let k = 0; k < SEG; k++) {
        const p = arc(k), q = arc(k + 1), pi = inner(k), qi = inner(k + 1);
        steel.beam(V(l, p.a, p.y - 0.06), V(l, q.a, q.y - 0.06), 0.16, 0.12);
        steel.beam(V(l, pi.a, pi.y), V(l, qi.a, qi.y), 0.12, 0.1);
        steel.beam(V(l, k % 2 ? p.a : pi.a, k % 2 ? p.y - 0.06 : pi.y), V(l, k % 2 ? qi.a : q.a, k % 2 ? qi.y : q.y - 0.06), 0.06);
      }
      this.stats.arches++;
    }
    // purlins (glazing rails) along the vault at every other arch segment, and the edge girders at the springing
    for (let k = 2; k < SEG; k += 3) { const p = arc(k); steel.beam(V(L0, p.a, p.y - 0.1), V(L1, p.a, p.y - 0.1), 0.08, 0.1); }
    for (const a of [A0, A1]) steel.beam(V(L0, a, R.springY - 0.25), V(L1, a, R.springY - 0.25), 0.45, 0.5);
    // glazed gable fans at both ends (the vault's end arches) with an end arch
    for (const l of [L0, L1]) {
      const n = alongX ? [l === L0 ? 1 : -1, 0, 0] : [0, 0, l === L0 ? 1 : -1];
      for (let k = 0; k < SEG; k++) {
        const p = arc(k), q = arc(k + 1);
        glass.quad([P(l, p.a, R.springY), P(l, q.a, R.springY), P(l, q.a, q.y), P(l, p.a, p.y)], n, [[p.a, R.springY], [q.a, R.springY], [q.a, q.y], [p.a, p.y]]);
      }
      for (let k = 2; k < SEG; k += 3) { const p = arc(k); steel.beam(V(l, p.a, R.springY), V(l, p.a, p.y), 0.08); }
      steel.beam(V(l, A0, R.springY), V(l, A1, R.springY), 0.2, 0.2);
    }
    // the clerestory: glazing on every edge of the glazed opening from the roof-edge beam (over the top floor's ceiling) up to the
    // springing line, mullions every 1.5 m
    const yB = this.topRingCeil + ROOF_BEAM;
    const out = this.roofPolygon();
    if (R.springY - yB > 0.2 && out.length >= 3) {
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.05) continue;
        const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        glass.quad([[a.x, yB, a.z], [b.x, yB, b.z], [b.x, R.springY, b.z], [a.x, R.springY, a.z]], [nx, 0, nz], [[0, yB], [len, yB], [len, R.springY], [0, R.springY]]);
        for (let sx = 0; sx <= len + 1e-6; sx += Math.max(0.75, len / Math.max(1, Math.round(len / 1.5)))) {
          const px = a.x + (b.x - a.x) * sx / len, pz = a.z + (b.z - a.z) * sx / len;
          steel.beam(new THREE.Vector3(px, yB, pz), new THREE.Vector3(px, R.springY, pz), 0.07, 0.07);
        }
        steel.beam(new THREE.Vector3(a.x, R.springY - 0.05, a.z), new THREE.Vector3(b.x, R.springY - 0.05, b.z), 0.12, 0.1);
      }
    }
    // cells at the springing line: inside the opening but outside the vault = FLAT GLAZING (rafters every 3 m both ways); inside
    // the vault rect but outside the opening (v1 records only) = an opaque ledge plate
    const up = [0, 1, 0];
    const ledge = new Mesher();
    const inVault = (x: number, z: number) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1;
    const B = {x0: Math.min(o.x0, R.outline.x0), z0: Math.min(o.z0, R.outline.z0), x1: Math.max(o.x1, R.outline.x1), z1: Math.max(o.z1, R.outline.z1)};
    const cx0 = Math.max(0, Math.floor(B.x0 / CELL)), cx1 = Math.min(this.W, Math.ceil(B.x1 / CELL));
    const cy0 = Math.max(0, Math.floor(B.z0 / CELL)), cy1 = Math.min(this.H, Math.ceil(B.z1 / CELL));
    const hasPoly = !!(R.polygon && R.polygon.length >= 3);
    const kindAt = (cx: number, cy: number): 'flat' | 'ledge' | 'deck' | 'vault' => {
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      const glazed = this.roofCell[cy * this.W + cx] === 1 && (hasPoly || pointInPoly(out, x, z));
      if (inVault(x, z)) return glazed ? 'vault' : 'ledge';
      return glazed ? 'flat' : 'deck';
    };
    let flatCells = 0;
    const flat = new Uint8Array(this.W * this.H);
    for (let cy = cy0; cy < cy1; cy++) {
      for (let cx = cx0; cx < cx1;) {
        const k = kindAt(cx, cy);
        let e = cx + 1;
        while (e < cx1 && kindAt(e, cy) === k) e++;
        const ax = cx * CELL, bx = e * CELL, az = cy * CELL, bz = (cy + 1) * CELL;
        if (k === 'flat') {
          glass.quad([[ax, R.springY, az], [ax, R.springY, bz], [bx, R.springY, bz], [bx, R.springY, az]], [0, -1, 0], [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
          for (let x = cx; x < e; x++) flat[cy * this.W + x] = 1;
          flatCells += e - cx;
        } else if (k === 'ledge') {
          ledge.quad([[ax, R.springY, az], [ax, R.springY, bz], [bx, R.springY, bz], [bx, R.springY, az]], [0, -1, 0], [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
          ledge.quad([[ax, R.springY + 0.01, az], [ax, R.springY + 0.01, bz], [bx, R.springY + 0.01, bz], [bx, R.springY + 0.01, az]], up, [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
        } else if (k === 'deck') {
          const yD = yB + 0.02;
          deck.quad([[ax, yD, az], [ax, yD, bz], [bx, yD, bz], [bx, yD, az]], up, [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
        }
        cx = e;
      }
    }
    // rafters under the flat glazing: along x on every 3 m z line, along z on every 3 m x line (runs over flat cells)
    const RAF = Math.round(3 / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      if (cy % RAF) continue;
      for (let cx = cx0; cx < cx1;) {
        const on = (x: number) => (flat[cy * this.W + x] || (cy > 0 && flat[(cy - 1) * this.W + x])) === 1;
        if (!on(cx)) { cx++; continue; }
        let e = cx + 1;
        while (e < cx1 && on(e)) e++;
        steel.beam(new THREE.Vector3(cx * CELL, R.springY - 0.1, cy * CELL), new THREE.Vector3(e * CELL, R.springY - 0.1, cy * CELL), 0.1, 0.16);
        cx = e;
      }
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      if (cx % RAF) continue;
      for (let cy = cy0; cy < cy1;) {
        const on = (y: number) => (flat[y * this.W + cx] || (cx > 0 && flat[y * this.W + cx - 1])) === 1;
        if (!on(cy)) { cy++; continue; }
        let e = cy + 1;
        while (e < cy1 && on(e)) e++;
        steel.beam(new THREE.Vector3(cx * CELL, R.springY - 0.1, cy * CELL), new THREE.Vector3(cx * CELL, R.springY - 0.1, e * CELL), 0.1, 0.16);
        cy = e;
      }
    }
    this.stats.flatGlazingM2 = flatCells * CELL * CELL;
    // the building's roof deck around the opening (membrane) at the beam top, seen through the clerestory / vault glass
    const yD = yB + 0.02, ring = 12;
    const x0 = B.x0 - ring, x1 = B.x1 + ring, z0 = B.z0 - ring, z1 = B.z1 + ring;
    for (const [ax, az, bx, bz] of [[x0, z0, x1, B.z0], [x0, B.z1, x1, z1], [x0, B.z0, B.x0, B.z1], [B.x1, B.z0, x1, B.z1]]) {
      deck.quad([[ax, yD, az], [ax, yD, bz], [bx, yD, bz], [bx, yD, az]], up, [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
    }
    const all = this.allLevels;
    add(glass.mesh(this.dress.glassRoof, 'mall-roof-glass', {levels: all}));
    add(steel.mesh(this.dress.whiteSteel, 'mall-roof-steel', {levels: all}));
    add(deck.mesh(this.dress.membrane, 'mall-roof-deck', {levels: all}));
    add(ledge.mesh(this.dress.whiteSteel, 'mall-roof-ledge', {levels: all}));
    // the sky over the roof: the Office's exterior murk (task mall-playtest-revision U02; unlit, never fogged, depth-write off,
    // drawn first, only seen through the glass)
    const dome = new THREE.SphereGeometry(190, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const sky = new THREE.Mesh(dome, this.dress.sky);
    sky.position.set((B.x0 + B.x1) / 2, this.topRingCeil, (B.z0 + B.z1) / 2);
    sky.name = 'mall-sky';
    sky.userData.levels = all;
    sky.renderOrder = MALL_EXT_ORDER.sky;
    sky.matrixAutoUpdate = false;
    sky.updateMatrix();
    add(sky);
    // U02: the toxic gas drifting above / round the glass roof (outside only: over the vault apex, on the roof round the vault, a
    // curtain beyond the roof edge), composited under every glass (world/mallExterior.ts)
    const ext = buildMallExteriorGas({roof: {...B}, vault: {...o}, deckY: yD, springY: R.springY, apexY: R.apexY});
    for (const m of ext.meshes) { m.userData.levels = all; add(m); }
    this.stats.exteriorGas = ext.stats.layers;
    this.stats.exteriorCurtain = ext.stats.curtainOpacity;
  }

  /** Glass balustrades + stainless handrails + base shoes on every owned rail run (per storey, per 48 m chunk). */
  private buildBalustrades(add: (m: THREE.Mesh | null) => void, rails: readonly RailRun[]): void {
    const lists = new Map<string, {level: number; glass: Mesher; rail: Mesher; shoe: Mesher}>();
    const PANEL = 1.5, GAP = 0.02, TOP = RAIL_HEIGHT;
    // the pitched run rails along an escalator are its own glass balustrades (traversalBuilder's escalator visual): not twice
    const esc = mallEscalatorFlights(this.layout).map(e => this.layout.grid.ramps[e.flight.ramp]).filter(Boolean).map(r => ({
      x0: r.x * CELL - 0.4, z0: r.y * CELL - 0.4, x1: (r.x + r.w) * CELL + 0.4, z1: (r.y + r.h) * CELL + 0.4}));
    const onEscalator = (r: RailRun) => Math.abs(r.y1 - r.y0) > 0.05 && esc.some(q =>
      Math.min(r.x0, r.x1) >= q.x0 && Math.max(r.x0, r.x1) <= q.x1 && Math.min(r.z0, r.z1) >= q.z0 && Math.max(r.z0, r.z1) <= q.z1);
    for (const r of rails) {
      if (!this.ownsRail(r) || (r as {hidden?: boolean}).hidden || onEscalator(r)) continue;
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      if (len < 0.05) continue;
      const key = `${r.level}:${Math.floor((r.x0 + r.x1) / 2 / CHUNK_M)},${Math.floor((r.z0 + r.z1) / 2 / CHUNK_M)}`;
      let L = lists.get(key);
      if (!L) lists.set(key, (L = {level: r.level, glass: new Mesher(), rail: new Mesher(), shoe: new Mesher()}));
      this.stats.balustradeM += len;
      this.stats.balustradeRuns++;
      const at = (s: number, dy: number): [number, number, number] => {
        const u = s / len;
        return [r.x0 + (r.x1 - r.x0) * u, r.y0 + (r.y1 - r.y0) * u + dy, r.z0 + (r.z1 - r.z0) * u];
      };
      const n = [r.nx, 0, r.nz];
      const panels = Math.max(1, Math.round(len / PANEL));
      for (let p = 0; p < panels; p++) {
        const sa = (len * p) / panels + (p ? GAP / 2 : 0), sb = (len * (p + 1)) / panels - (p < panels - 1 ? GAP / 2 : 0);
        L.glass.quad2([at(sa, 0.1), at(sb, 0.1), at(sb, TOP - 0.06), at(sa, TOP - 0.06)], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      const v = (s: number, dy: number) => new THREE.Vector3(...at(s, dy));
      L.rail.beam(v(0, TOP), v(len, TOP), 0.055, 0.055);
      L.shoe.beam(v(0, 0.05), v(len, 0.05), 0.07, 0.1);
    }
    for (const [key, L] of lists) {
      add(L.glass.mesh(this.dress.glassRail, `mall-balustrade-glass-${key}`, {level: L.level}));
      add(L.rail.mesh(this.dress.stainless, `mall-balustrade-rail-${key}`, {level: L.level}));
      add(L.shoe.mesh(this.dress.darkSteel, `mall-balustrade-shoe-${key}`, {level: L.level}));
    }
  }

  /**
   * White round columns with dark tile bands below every ring's slab, outboard of the balustrades: along each straight void
   * edge >= 6 m, at its ends and every ~8.5 m, 0.55 m into the void, only where the whole footprint is a clear void column on
   * every storey (never through a bridge, escalator, shaft or a ring floor).
   */
  private buildColumns(add: (m: THREE.Mesh | null) => void): void {
    // Task mall-playtest-revision-20261031 (lane FIX U04 -> ARCH render): columns are layout records (props of kind 'atriumColumn',
    // with their colliders / nav / bullet blocking) — drawn exactly there (visual = collider). The v2 atrium widens upward, so the
    // old placement (0.6 m into the floor-1 opening, up to the roof) would stand in open air above floor 1: without records, a v2
    // mall draws none (never a column ending at nothing); v1 records keep the old placement.
    const recs = this.layout.props.filter(p => (p.kind as string) === 'atriumColumn');
    if (recs.length || (this.info.void.openings?.length ?? 0) > 0) { this.buildColumnRecords(add, recs); return; }
    const out = this.info.void.outline;
    if (out.length < 3) return;
    const ringsOpen = this.levels.filter(l => l.id !== this.floorLevel);
    const clear = (x: number, z: number, r: number): boolean => {
      for (let dz = -r; dz <= r + 1e-6; dz += CELL / 2) for (let dx = -r; dx <= r + 1e-6; dx += CELL / 2) {
        const cx = Math.floor((x + dx) / CELL), cy = Math.floor((z + dz) / CELL);
        if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return false;
        const i = cy * this.W + cx;
        if (!this.voidCol[i]) return false;
        for (const L of ringsOpen) { const c = L.grid.cells[i]; if (c === FLOOR || c === VOID) return false; }
      }
      return true;
    };
    const inside = (x: number, z: number) => pointInPoly(out, x, z);
    const rings = this.info.storeys.filter(s => s.role === 'ring').sort((a, b) => a.baseY - b.baseY);
    const shaft = new Mesher(), tile = new Mesher();
    const R = 0.34, top = Math.min(this.info.roof.springY, this.topRingCeil + 0.6);
    const placed: {x: number; z: number}[] = [];
    const gf = this.gridOf(this.floorLevel);
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 6) continue;
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
      let nx = -tz, nz = tx;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!inside(mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
      const count = Math.max(1, Math.round(len / 8.5));
      for (let k = 0; k <= count; k++) {
        const s = Math.min(len - 0.8, Math.max(0.8, (len * k) / count));
        const x = a.x + tx * s + nx * 0.6, z = a.z + tz * s + nz * 0.6;
        if (placed.some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
        if (!clear(x, z, R)) continue;
        placed.push({x, z});
        const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
        const y0 = gf.floorOf(cy * this.W + cx);
        shaft.cyl(x, y0, z, R, top - y0, 16);
        // dark tile plinth and a tile band under every ring's slab edge (just below the fascia's soffit line)
        tile.cyl(x, y0, z, R + 0.012, 0.32, 16);
        for (let k2 = 0; k2 < rings.length; k2++) {
          const below = k2 > 0 ? rings[k2 - 1].baseY + rings[k2 - 1].clear : (this.storeyOf(this.floorLevel)?.baseY ?? 0) + 4.2;
          const yb = Math.min(below, rings[k2].baseY - 0.2) - 0.6;
          if (yb > y0 + 0.5) tile.cyl(x, yb, z, R + 0.012, 0.5, 16);
        }
      }
    }
    this.stats.columns = placed.length;
    const all = this.allLevels;
    add(shaft.mesh(this.dress.columnRender, 'mall-columns', {levels: all}));
    add(tile.mesh(this.dress.columnTile, 'mall-column-bands', {levels: all}));
  }

  /** Round columns from layout records (kind 'atriumColumn': x, z, y = foot, h, hx = radius): render + dark tile plinth / head bands. */
  private buildColumnRecords(add: (m: THREE.Mesh | null) => void, recs: readonly {x: number; z: number; y: number; h: number; hx: number; level?: number}[]): void {
    if (!recs.length) return;
    const shaft = new Mesher(), tile = new Mesher();
    const lv = new Set<number>();
    for (const p of recs) {
      const R = Math.max(0.1, p.hx), y0 = p.y, top = p.y + p.h;
      shaft.cyl(p.x, y0, p.z, R, top - y0, 18);
      tile.cyl(p.x, y0, p.z, R + 0.012, Math.min(0.32, (top - y0) * 0.2), 18);
      if (top - y0 > 1.6) tile.cyl(p.x, top - 0.5, p.z, R + 0.012, 0.42, 18); // a band under the slab it carries
      for (const st of this.info.storeys) if (st.baseY <= top + 0.01 && st.baseY + st.clear >= y0 - 0.01) lv.add(st.level);
    }
    this.stats.columns = recs.length;
    const levels = lv.size ? [...lv].sort((a, b) => a - b) : this.allLevels;
    add(shaft.mesh(this.dress.columnRender, 'mall-columns', {levels}));
    add(tile.mesh(this.dress.columnTile, 'mall-column-bands', {levels}));
  }

  /** Steel-frame glass shaft towers: glazing on every atrium-facing side, corner posts, storey girts, the machine head. */
  private buildShaftTowers(add: (m: THREE.Mesh | null) => void): void {
    if (!this.info.elevators.length) return;
    const glass = new Mesher(), frame = new Mesher();
    for (const e of this.info.elevators) {
      const s = e.shaft;
      const ys = e.stops.map(q => q.y).sort((a, b) => a - b);
      // (task mall-playtest-revision U07: the head / pit match the glass car's rig — world/elevator.ts GLASS_RIG / planGlassRig)
      const y0 = Math.min(ys[0] ?? 0, this.gridOf(this.floorLevel).floorAt((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)), yTop = (ys[ys.length - 1] ?? 0) + GLASS_RIG.headroom;
      const sides: {a: [number, number]; b: [number, number]; n: [number, number]}[] = [
        {a: [s.x0, s.z0], b: [s.x1, s.z0], n: [0, -1]}, {a: [s.x1, s.z1], b: [s.x0, s.z1], n: [0, 1]},
        {a: [s.x0, s.z1], b: [s.x0, s.z0], n: [-1, 0]}, {a: [s.x1, s.z0], b: [s.x1, s.z1], n: [1, 0]},
      ];
      const glassy = this.glassSides();
      for (const sd of sides) {
        // every side but the landing-door side (lane GEN's mallTowerRecord) is glazed on every storey
        const name = sd.n[1] < 0 ? 'N' : sd.n[1] > 0 ? 'S' : sd.n[0] < 0 ? 'W' : 'E';
        if (!glassy.has(name)) continue;
        const n = [sd.n[0], 0, sd.n[1]];
        const levelsY = [y0, ...ys.filter(y => y > y0 + 0.5), yTop];
        for (let k = 0; k + 1 < levelsY.length; k++) {
          const ya = levelsY[k] + 0.05, yb = levelsY[k + 1] - 0.05;
          glass.quad2([[sd.a[0], ya, sd.a[1]], [sd.b[0], ya, sd.b[1]], [sd.b[0], yb, sd.b[1]], [sd.a[0], yb, sd.a[1]]], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          this.stats.shaftPanels++;
          frame.beam(new THREE.Vector3(sd.a[0], levelsY[k], sd.a[1]), new THREE.Vector3(sd.b[0], levelsY[k], sd.b[1]), 0.14, 0.18);
        }
      }
      for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z0], [s.x0, s.z1], [s.x1, s.z1]]) frame.box(x, (y0 + yTop) / 2, z, 0.2, yTop - y0, 0.2);
      // machine head housing on top (the machine bed, sheaves, rails, pit and ropes inside are the car rig's: world/elevator.ts)
      frame.box((s.x0 + s.x1) / 2, yTop + GLASS_RIG.headH / 2, (s.z0 + s.z1) / 2, s.x1 - s.x0 + 0.3, GLASS_RIG.headH, s.z1 - s.z0 + 0.3);
      // a cornice band round the housing's foot
      frame.box((s.x0 + s.x1) / 2, yTop + 0.06, (s.z0 + s.z1) / 2, s.x1 - s.x0 + 0.42, 0.12, s.z1 - s.z0 + 0.42);
    }
    const all = this.allLevels;
    add(glass.mesh(this.dress.glassRail, 'mall-shaft-glass', {levels: all}));
    add(frame.mesh(this.dress.darkSteel, 'mall-shaft-frame', {levels: all}));
  }

  /** Shopfront fascia signs, projecting blade signs and the Level labels on the void fascias (one atlas). */
  private buildSignage(group: THREE.Group, add: (m: THREE.Mesh | null) => void): void {
    const faces = new Map<THREE.Texture, {m: THREE.Matrix4; level: number}[]>();
    const face = (tex: THREE.Texture, m: THREE.Matrix4, level: number) => { let l = faces.get(tex); if (!l) faces.set(tex, (l = [])); l.push({m, level}); };
    const boxes = new Map<number, Mesher>();
    const boxOf = (level: number) => { let b = boxes.get(level); if (!b) boxes.set(level, (b = new Mesher())); return b; };
    const q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    const doors = this.layout.doors ?? [];
    const brandTex = new Map<string, THREE.Texture>(), bladeTex = new Map<string, THREE.Texture>();
    for (const s of this.info.shops) {
      if (s.kind === 'kiosk') continue;
      const st = this.storeyOf(s.level);
      if (!st) continue;
      const f = s.frontage;
      // the gallery side from GEOMETRY (lanes disagree on what frontage.side names: GEN's is the unit's side of the gallery)
      const fg = this.frontGeometry(s);
      if (!fg) continue;
      const {alongX, nrm} = fg;
      const plane = fg.galleryPlane;
      const a0 = alongX ? f.x0 : f.z0, a1 = alongX ? f.x1 : f.z1;
      const w = a1 - a0;
      if (w < 1) continue;
      // opening head: the shop's frontage door, else 3 m (never above the gallery ceiling)
      const d = doors.find(dd => ((dd as {level?: number}).level ?? 0) === s.level && dd.x * CELL < f.x1 + 0.3 && (dd.x + dd.w) * CELL > f.x0 - 0.3 && dd.y * CELL < f.z1 + 0.3 && (dd.y + dd.h) * CELL > f.z0 - 0.3);
      const head = st.baseY + Math.min(d?.height ?? 3.0, st.clear - 0.9);
      const top = Math.min(st.baseY + st.clear - 0.08, head + 0.85);
      if (top - head < 0.35) continue;
      const cxw = (a0 + a1) / 2;
      const sw = Math.min(w - 0.2, Math.max(2, w * 0.8)), sh = Math.min(0.62, top - head - 0.12);
      const yaw = Math.atan2(nrm[0], nrm[1]);
      // fascia band (box) across the frontage, proud of the gallery wall
      const bx = alongX ? cxw : plane + nrm[0] * 0.07, bz = alongX ? plane + nrm[1] * 0.07 : cxw;
      boxOf(s.level).box(bx, (head + top) / 2, bz, alongX ? w + 0.2 : 0.14, top - head, alongX ? 0.14 : w + 0.2);
      // the brand face
      const tk = `${s.brand}|${s.program}`;
      let tex = brandTex.get(tk);
      if (!tex) brandTex.set(tk, (tex = brandSignTexture(s.brand, s.program, hashStr(tk))));
      const fx = alongX ? cxw : plane + nrm[0] * 0.145, fz = alongX ? plane + nrm[1] * 0.145 : cxw;
      face(tex, new THREE.Matrix4().compose(new THREE.Vector3(fx, (head + top) / 2, fz), q.setFromAxisAngle(UP, yaw), new THREE.Vector3(sw, sh, 1)), s.level);
      this.stats.signs++;
      // projecting blade sign at one end of the frontage (double-sided), 0.9 m out, under the gallery ceiling
      if (w >= 3 && st.clear >= 3.4) {
        const be = a1 - 0.4, by = Math.min(st.baseY + st.clear - 0.55, top + 0.4);
        const bxx = alongX ? be : plane + nrm[0] * 0.55, bzz = alongX ? plane + nrm[1] * 0.55 : be;
        let btex = bladeTex.get(tk);
        if (!btex) bladeTex.set(tk, (btex = bladeSignTexture(s.brand, s.program, hashStr(tk) + 7)));
        const byaw = yaw + Math.PI / 2;
        for (const side of [0, Math.PI]) {
          face(btex, new THREE.Matrix4().compose(new THREE.Vector3(bxx, by, bzz), q.setFromAxisAngle(UP, byaw + side), new THREE.Vector3(0.62, 0.62, 1))
            .multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.022)), s.level);
        }
        boxOf(s.level).box(bxx, by, bzz, alongX ? 0.04 : 0.66, 0.66, alongX ? 0.66 : 0.04);
        boxOf(s.level).box(alongX ? be : plane + nrm[0] * 0.28, by + 0.36, alongX ? plane + nrm[1] * 0.28 : be, alongX ? 0.03 : 0.56, 0.03, alongX ? 0.56 : 0.03);
        this.stats.blades++;
      }
    }
    // Level labels on the slab-edge fascias: on the longest edges of THAT floor's opening (task mall-playtest-revision: the openings
    // widen upward, each floor's slab edge is its own outline), facing into the void, two per edge
    const rings = this.info.storeys.filter(s => s.role === 'ring');
    for (const st of rings) {
      const out = this.openingOf(st.level);
      const edges = out.map((a, i) => ({a, b: out[(i + 1) % out.length]})).map(e => ({...e, len: Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z)})).sort((p, q2) => q2.len - p.len).slice(0, 2);
      const prev = this.info.storeys.filter(s => s.baseY < st.baseY).sort((a, b) => b.baseY - a.baseY)[0];
      const slab = prev ? st.baseY - (prev.baseY + prev.clear) : 1;
      const hgt = Math.min(0.55, slab - 0.2);
      if (hgt < 0.25) continue;
      const tex = levelLabelTexture(st.label, st.level);
      for (const e of edges) {
        if (e.len < 8) continue;
        const tx = (e.b.x - e.a.x) / e.len, tz = (e.b.z - e.a.z) / e.len;
        for (const t of [0.25, 0.75]) {
          let nx = -tz, nz = tx;
          const px = e.a.x + tx * e.len * t, pz = e.a.z + tz * e.len * t;
          if (!pointInPoly(out, px + nx * 0.3, pz + nz * 0.3)) { nx = -nx; nz = -nz; }
          if (!pointInPoly(out, px + nx * 0.3, pz + nz * 0.3)) continue;
          const yaw = Math.atan2(nx, nz);
          face(tex, new THREE.Matrix4().compose(new THREE.Vector3(px + nx * 0.025, st.baseY - 0.12 - hgt / 2, pz + nz * 0.025), q.setFromAxisAngle(UP, yaw), new THREE.Vector3(hgt * 3.2, hgt, 1)), st.level);
          this.stats.labels++;
        }
      }
    }
    // directory pylons (gen/mall/landmarks.ts): body in the sign boxes, the storey plan on the front, the brand directory on the back
    for (const p of this.layout.props) {
      if (p.kind !== 'directoryPylon') continue;
      const lv = p.level ?? 0;
      boxOf(lv).box(p.x, p.y + p.h / 2, p.z, p.hx * 2, p.h, p.hz * 2);
      const plan = directoryPlanTexture(this.layout, lv, {x: p.x, z: p.z}, this.atrium, 9500 + lv * 7 + Math.round(p.x));
      const list = directoryListTexture(this.layout, lv, 9600 + lv);
      const yaw = p.rot, fwd = PYLON_FACE.d / 2 + 0.004;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      for (const [tex, sgn] of [[plan, 1], [list, -1]] as const) {
        face(tex, new THREE.Matrix4().compose(new THREE.Vector3(p.x + fx * fwd * sgn, p.y + PYLON_FACE.y, p.z + fz * fwd * sgn), q.setFromAxisAngle(UP, yaw + (sgn < 0 ? Math.PI : 0)),
          new THREE.Vector3(PYLON_FACE.w, PYLON_FACE.h, 1)), lv);
      }
      this.stats.pylons++;
    }
    for (const [lv, b] of boxes) add(b.mesh(this.dress.darkSteel, `mall-sign-boxes-${lv}`, {level: lv}));
    if (faces.size) this.buildSignFaces(group, faces, add);
  }

  /** Sign faces in atlas pages (one instanced plane mesh per page and storey). */
  private buildSignFaces(group: THREE.Group, faces: Map<THREE.Texture, {m: THREE.Matrix4; level: number}[]>, add: (m: THREE.Mesh | null) => void): void {
    const texs = [...faces.keys()];
    const imgs = texs.map(t => t.image as {width: number; height: number});
    const {cells, pages} = packAtlas(imgs);
    pages.forEach((Hh, pg) => {
      const mine = cells.map((c, i) => [c, i] as const).filter(([c]) => c[0] === pg);
      const atlas = canvasTexture(ATLAS_W, Hh, 9700 + pg, ctx => {
        ctx.fillStyle = '#1f2225';
        ctx.fillRect(0, 0, ATLAS_W, Hh);
        for (const [[, x, y, w, h], i] of mine) {
          const img = imgs[i] as unknown as CanvasImageSource;
          ctx.drawImage(img, x - 4, y - 4, w + 8, h + 8);
          ctx.drawImage(img, x, y, w, h);
        }
      });
      atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
      const ms: THREE.Matrix4[] = [], rects: number[] = [], lv = new Set<number>();
      for (const [[, x, y, w, h], i] of mine) for (const e of faces.get(texs[i])!) {
        ms.push(e.m);
        lv.add(e.level);
        rects.push(x / ATLAS_W, 1 - (y + h) / Hh, w / ATLAS_W, h / Hh);
      }
      if (!ms.length) return;
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array(rects), 4));
      const im = new THREE.InstancedMesh(geo, signAtlasMaterial(atlas), ms.length);
      ms.forEach((m, k) => im.setMatrixAt(k, m));
      im.name = `mall-sign-faces-${pg}`;
      if (lv.size === 1) im.userData.level = [...lv][0]; else im.userData.levels = [...lv].sort((a, b) => a - b);
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      group.add(im);
      this.stats.meshes++;
      this.stats.triangles += 2 * ms.length;
    });
    for (const t of texs) t.dispose();
    void add;
  }

  /**
   * A shop frontage's geometry from the record AND the sales area (never from frontage.side alone: lanes name it differently):
   * axis, outward normal toward the gallery, the door-row centre line, the gallery-side face plane, the span, the storey base.
   */
  frontGeometry(s: MallShop): {alongX: boolean; nrm: [number, number]; line: number; galleryPlane: number; s0: number; s1: number; base: number} | null {
    const f = s.frontage, a = this.layout.areas[s.area];
    if (!a) return null;
    const alongX = Math.abs(f.x1 - f.x0) >= Math.abs(f.z1 - f.z0) ? true : false;
    const acx = (a.x + a.w / 2) * CELL, acz = (a.y + a.h / 2) * CELL;
    const fcx = (f.x0 + f.x1) / 2, fcz = (f.z0 + f.z1) / 2;
    const sgn = alongX ? Math.sign(fcz - acz) || 1 : Math.sign(fcx - acx) || 1;
    const nrm: [number, number] = alongX ? [0, sgn] : [sgn, 0];
    const line = alongX ? fcz : fcx;
    const galleryPlane = alongX ? (sgn > 0 ? Math.max(f.z0, f.z1) : Math.min(f.z0, f.z1)) : (sgn > 0 ? Math.max(f.x0, f.x1) : Math.min(f.x0, f.x1));
    const s0 = alongX ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1), s1 = alongX ? Math.max(f.x0, f.x1) : Math.max(f.z0, f.z1);
    const base = a.floorY ?? this.storeyOf(s.level)?.baseY ?? 0;
    return {alongX, nrm, line, galleryPlane, s0, s1, base};
  }

  /**
   * Shopfronts (lane SHOPS' collision-only props, drawn exactly over their colliders: visual = collider):
   *  - `shopGlazing`: a full-height frameless glass pane over the prop box (lit shopfront glass, transparent: never a shadow caster)
   *    in a dark base rail + head rail (no posts: a shattered pane leaves nothing standing in its opening while the collider drops to
   *    the 0.3 m base) and a bulkhead from the collider top to the opening head (above head height);
   *  - `shopShutter`: a rolled-down slatted steel shutter over the prop box (curtain + head box + guide channels, aged paint);
   *  - fit.shutter 'partial': the curtain rolled down only to ~2.4 m with its head box, offset to the gallery side of the glass —
   *    visual only, above head height, no collider (a separate mesh the damage index never cuts).
   * Merged per storey: 'shopfront-mall-glass-L', 'shopfront-mall-frame-L', 'shopfront-mall-shutter-L' (the damage system cuts a
   * hit prop's triangles out of 'shopfront-*' meshes: glass shatters, the shutter dents) + 'mall-shutter-partial-L'.
   */
  buildShopfronts(add: (m: THREE.Mesh | null) => void, mats: WorldMaterials): void {
    type Lists = {glass: Mesher; frame: Mesher; shutter: Mesher; partial: Mesher};
    const per = new Map<number, Lists>();
    const L = (lv: number): Lists => { let l = per.get(lv); if (!l) per.set(lv, (l = {glass: new Mesher(), frame: new Mesher(), shutter: new Mesher(), partial: new Mesher()})); return l; };
    const doors = this.layout.doors ?? [];
    const shopByArea = this.shopByArea;
    const openingHead = (s: MallShop | undefined, base: number): number => {
      if (!s) return base + 3.4;
      const f = s.frontage;
      const d = doors.find(dd => ((dd as {level?: number}).level ?? 0) === s.level && dd.x * CELL < Math.max(f.x0, f.x1) + 0.3 && (dd.x + dd.w) * CELL > Math.min(f.x0, f.x1) - 0.3
        && dd.y * CELL < Math.max(f.z0, f.z1) + 0.3 && (dd.y + dd.h) * CELL > Math.min(f.z0, f.z1) - 0.3);
      return base + (d?.height ?? 3.4);
    };
    // a vertical box between a0..a1 along the frontage, at `line` (thickness t), y0..y1
    const vbox = (m: Mesher, alongX: boolean, a0: number, a1: number, line: number, t: number, y0: number, y1: number) => {
      if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
      const c = (a0 + a1) / 2, w = a1 - a0;
      m.box(alongX ? c : line, (y0 + y1) / 2, alongX ? line : c, alongX ? w : t, y1 - y0, alongX ? t : w);
    };
    const levelOfArea = (id: number) => this.layout.areas[id]?.level ?? 0;
    for (const p of this.layout.props) {
      if ((p.kind !== 'shopGlazing' && p.kind !== 'shopShutter') || p.shop !== undefined) continue;
      const alongX = p.hx >= p.hz;
      const a0 = alongX ? p.x - p.hx : p.z - p.hz, a1 = alongX ? p.x + p.hx : p.z + p.hz;
      const line = alongX ? p.z : p.x, t = Math.min(alongX ? p.hz : p.hx, 0.06) * 2;
      const y0 = p.y, y1 = p.y + p.h, lv = levelOfArea(p.area);
      const lists = L(lv);
      const shop = shopByArea.get(p.area);
      const head = openingHead(shop, y0);
      const n = alongX ? [0, 0, 1] : [1, 0, 0];
      if (p.kind === 'shopGlazing') {
        const J = 0.004, R = 0.11; // frameless butt-jointed glass: no post survives a shatter inside the walkway
        // the pane (both faces; world-mapped grimy shopfront glass)
        lists.glass.quad2(alongX ? [[a0 + J, y0 + R, line], [a1 - J, y0 + R, line], [a1 - J, y1 - 0.06, line], [a0 + J, y1 - 0.06, line]]
          : [[line, y0 + R, a0 + J], [line, y0 + R, a1 - J], [line, y1 - 0.06, a1 - J], [line, y1 - 0.06, a0 + J]], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        vbox(lists.frame, alongX, a0, a1, line, t + 0.02, y0, y0 + R);          // base rail (the 0.3 m plinth left by a shatter)
        vbox(lists.frame, alongX, a0, a1, line, t + 0.02, y1 - 0.06, y1);       // head rail
        if (head > y1 + 0.02) vbox(lists.frame, alongX, a0, a1, line, 0.16, y1, head); // bulkhead to the opening head (above head height)
        this.stats.glazing++;
      } else {
        // rolled-down shutter: slatted curtain, head box (gallery side), guide channels at both ends
        const hb = 0.34;
        vbox(lists.shutter, alongX, a0, a1, line, t, y0, y1 - hb);
        vbox(lists.shutter, alongX, a0, a1, line, Math.max(t, 0.12), y1 - hb, y1);
        vbox(lists.frame, alongX, a0, a0 + 0.06, line, t + 0.04, y0, y1);
        vbox(lists.frame, alongX, a1 - 0.06, a1, line, t + 0.04, y0, y1);
        vbox(lists.frame, alongX, a0, a1, line, t + 0.02, y0, y0 + 0.05);       // bottom bar
        if (head > y1 + 0.02) vbox(lists.frame, alongX, a0, a1, line, 0.16, y1, head);
        this.stats.shutters++;
      }
    }
    // partial shutters (visual only): curtain down to ~2.4 m over the whole frontage, on the gallery side of the glazing
    for (const s of this.info.shops) {
      const fit = (s as {fit?: {shutter?: string}}).fit;
      if (fit?.shutter !== 'partial') continue;
      const g = this.frontGeometry(s);
      if (!g) continue;
      const a = this.layout.areas[s.area];
      const top = g.base + Math.min(3.2, Math.max(2.4, (a?.ceil ?? g.base + 4) - g.base - 0.1));
      const bottom = Math.max(g.base + 2.25, top - 0.8);
      if (top - bottom < 0.15) continue;
      const line = g.line + (g.alongX ? g.nrm[1] : g.nrm[0]) * 0.12;
      const lists = L(s.level);
      vbox(lists.partial, g.alongX, g.s0, g.s1, line, 0.05, bottom, top);
      vbox(lists.partial, g.alongX, g.s0, g.s1, line, 0.14, top - 0.3, top);
      const head = openingHead(s, g.base);
      if (head > top + 0.02) vbox(lists.partial, g.alongX, g.s0, g.s1, g.line, 0.16, top, head);
      this.stats.partialShutters++;
    }
    const glassMat = shopGlassMaterial(mats), shutterMat = shapeMaterial(mats, 'shutter');
    for (const [lv, l] of per) {
      add(l.glass.mesh(glassMat, `shopfront-mall-glass-${lv}`, {level: lv}));
      add(l.frame.mesh(this.dress.darkSteel, `shopfront-mall-frame-${lv}`, {level: lv}));
      add(l.shutter.mesh(shutterMat, `shopfront-mall-shutter-${lv}`, {level: lv}));
      add(l.partial.mesh(shutterMat, `mall-shutter-partial-${lv}`, {level: lv}));
    }
  }

  /**
   * Task mall-playtest-revision-20261031 (lane ARCH, D06): advertising faces — lane SHOPS' records (`layout.mall.ads`: posters, lightboxes,
   * billboards, glass decals in / at their shops) + ARCH's gallery billboards on long blank public walls (world/mallAds.ts
   * planGalleryAds) — original vector art (fictional brands, generic dressed adult silhouettes, theme motifs), one canvas each,
   * packed into atlas pages: per page and storey ONE instanced face mesh (opaque pages; decals on cut-out pages), frames / boxes
   * merged per storey. Faces / frames sit on the wall (never a collider: nothing to bump, nothing blocks a door or a sign).
   */
  buildAds(group: THREE.Group, add: (m: THREE.Mesh | null) => void): void {
    const shopAds = adsOf(this.layout);
    const gallery = planGalleryAds(this.adWalls, this.layout, hashStr(this.info.name) + this.layout.seed, lv => this.storeyOf(lv)?.baseY ?? 0);
    this.ads = [...shopAds, ...gallery];
    this.stats.shopAds = shopAds.length;
    this.stats.galleryAds = gallery.length;
    if (!this.ads.length) return;
    const shopBrand = new Map(this.info.shops.map(q => [q.id, q.brand]));
    const opaque = new Map<THREE.Texture, {m: THREE.Matrix4; level: number}[]>(), cut = new Map<THREE.Texture, {m: THREE.Matrix4; level: number}[]>();
    const frames = new Map<number, {dark: Mesher; light: Mesher}>();
    const fr = (lv: number) => { let f = frames.get(lv); if (!f) frames.set(lv, (f = {dark: new Mesher(), light: new Mesher()})); return f; };
    const q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    for (const ad of this.ads) {
      // the advertiser: the shop's fictional brand (a vacant unit / a gallery ad: the seeded mall name)
      const tex = adTexture(ad, ad.shop && ad.program !== 'vacant' ? shopBrand.get(ad.shop) ?? this.info.name : this.info.name);
      const yaw = Math.atan2(ad.nx, ad.nz), alongX = Math.abs(ad.nz) > 0.5;
      // wall-mounted kinds stand on the real wall plane behind the record (whatever its proud offset): probe the storey grid
      const back = ad.kind === 'decal' ? 0 : this.wallBehind(ad);
      const at = (d: number) => new THREE.Vector3(ad.x + ad.nx * (d - back), ad.y, ad.z + ad.nz * (d - back));
      const faceAt = (d: number, turn: number) => new THREE.Matrix4().compose(at(d), q.setFromAxisAngle(UP, yaw + turn), new THREE.Vector3(ad.w, ad.h, 1));
      // a box of size (along the wall) x (height) x (depth from the wall) with its back on the wall plane
      const box = (m: Mesher, dy: number, wAlong: number, h: number, d0: number, d1: number, off = 0) => {
        const c = at((d0 + d1) / 2);
        const ox = alongX ? off : 0, oz = alongX ? 0 : off;
        m.box(c.x + ox, ad.y + dy, c.z + oz, alongX ? wAlong : d1 - d0, h, alongX ? d1 - d0 : wAlong);
      };
      const F = fr(ad.level);
      let list = opaque;
      switch (ad.kind) {
        case 'decal':
          list = cut;
          (cut.get(tex) ?? cut.set(tex, []).get(tex)!).push({m: faceAt(0.012, 0), level: ad.level}, {m: faceAt(-0.012, Math.PI), level: ad.level});
          continue;
        case 'poster': {
          // a snap frame (aluminium) on a dark backing plate
          box(F.dark, 0, ad.w + 0.02, ad.h + 0.02, 0, 0.012);
          for (const sg of [-1, 1]) {
            box(F.light, sg * (ad.h / 2 + 0.012), ad.w + 0.05, 0.03, 0, 0.026);
            box(F.light, 0, 0.03, ad.h + 0.05, 0, 0.026, sg * (ad.w / 2 + 0.012));
          }
          list.get(tex) ?? list.set(tex, []);
          list.get(tex)!.push({m: faceAt(0.016, 0), level: ad.level});
          break;
        }
        case 'lightbox':
          box(F.dark, 0, ad.w + 0.08, ad.h + 0.08, 0, 0.12);
          list.get(tex) ?? list.set(tex, []);
          list.get(tex)!.push({m: faceAt(0.122, 0), level: ad.level});
          break;
        default: {
          // billboard: a deep frame and a lamp bar on two arms over the top edge
          box(F.dark, 0, ad.w + 0.14, ad.h + 0.14, 0, 0.07);
          box(F.dark, ad.h / 2 + 0.2, ad.w * 0.7, 0.07, 0.32, 0.42);
          for (const sg of [-0.3, 0.3]) box(F.dark, ad.h / 2 + 0.13, 0.04, 0.12, 0.04, 0.4, sg * ad.w);
          list.get(tex) ?? list.set(tex, []);
          list.get(tex)!.push({m: faceAt(0.072, 0), level: ad.level});
        }
      }
    }
    for (const [lv, f] of frames) {
      add(f.dark.mesh(this.dress.darkSteel, `mall-ad-frames-${lv}`, {level: lv}));
      add(f.light.mesh(this.dress.trimLight, `mall-ad-trim-${lv}`, {level: lv}));
    }
    if (opaque.size) this.buildAtlasFaces(group, opaque, 'mall-ad-faces', false);
    if (cut.size) this.buildAtlasFaces(group, cut, 'mall-ad-decals', true);
  }

  /** Distance (m, 0..0.3) from an ad record back to the solid wall behind it on its storey grid (0: none found within 0.3 m). */
  private wallBehind(ad: MallAd): number {
    const g = this.gridOf(ad.level);
    for (let d = 0; d <= 0.3 + 1e-9; d += 0.005) {
      const x = ad.x - ad.nx * d, z = ad.z - ad.nz * d;
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return 0;
      if (g.cells[cy * this.W + cx] === SOLID) {
        // the boundary of that cell facing the record
        const plane = Math.abs(ad.nx) > 0.5 ? (ad.nx > 0 ? (cx + 1) * CELL : cx * CELL) : (ad.nz > 0 ? (cy + 1) * CELL : cy * CELL);
        return Math.max(0, Math.abs(ad.nx) > 0.5 ? (ad.x - plane) * ad.nx : (ad.z - plane) * ad.nz);
      }
    }
    return 0;
  }

  /** Atlas pages of canvas faces: per page and storey ONE instanced plane mesh (cut-out pages: alpha-tested, double-sided). */
  private buildAtlasFaces(group: THREE.Group, faces: Map<THREE.Texture, {m: THREE.Matrix4; level: number}[]>, name: string, cutout: boolean): void {
    const texs = [...faces.keys()];
    const imgs = texs.map(t => t.image as {width: number; height: number});
    const {cells, pages} = packAtlas(imgs);
    pages.forEach((Hh, pg) => {
      const mine = cells.map((c, i) => [c, i] as const).filter(([c]) => c[0] === pg);
      const atlas = canvasTexture(ATLAS_W, Hh, 9800 + pg + (cutout ? 50 : 0), ctx => {
        if (cutout) ctx.clearRect(0, 0, ATLAS_W, Hh); else { ctx.fillStyle = '#1f2225'; ctx.fillRect(0, 0, ATLAS_W, Hh); }
        for (const [[, x, y, w, h], i] of mine) {
          const img = imgs[i] as unknown as CanvasImageSource;
          if (!cutout) ctx.drawImage(img, x - 4, y - 4, w + 8, h + 8);
          ctx.drawImage(img, x, y, w, h);
        }
      });
      atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
      const mat = signAtlasMaterial(atlas);
      mat.name = cutout ? 'mall-ad-decal-atlas' : 'mall-ad-atlas';
      if (cutout) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; mat.transparent = false; }
      const byLevel = new Map<number, {ms: THREE.Matrix4[]; rects: number[]}>();
      for (const [[, x, y, w, h], i] of mine) for (const e of faces.get(texs[i])!) {
        let b = byLevel.get(e.level);
        if (!b) byLevel.set(e.level, (b = {ms: [], rects: []}));
        b.ms.push(e.m);
        b.rects.push(x / ATLAS_W, 1 - (y + h) / Hh, w / ATLAS_W, h / Hh);
      }
      for (const [lv, b] of byLevel) {
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array(b.rects), 4));
        const im = new THREE.InstancedMesh(geo, mat, b.ms.length);
        b.ms.forEach((m, k) => im.setMatrixAt(k, m));
        im.name = `${name}-${pg}-${lv}`;
        im.userData.level = lv;
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        group.add(im);
        this.stats.meshes++;
        this.stats.triangles += 2 * b.ms.length;
      }
    });
    for (const t of texs) t.dispose();
  }

  /**
   * The pit-plaza fountain (gen/mall/landmarks.ts `fountainBasin` + `fountainSpire`), drawn exactly in its colliders: a square
   * dark-granite basin wall with a broad pale-stone coping (the sitting ledge, 0.45-0.5 m), a dark basin floor, stagnant water at
   * 0.3 m (algae, scum, floating debris: the pumps died decades ago), and a tiered verdigris-bronze centrepiece on a stone plinth.
   */
  buildFountain(add: (m: THREE.Mesh | null) => void): void {
    const basins = this.layout.props.filter(p => p.kind === 'fountainBasin'), spires = this.layout.props.filter(p => p.kind === 'fountainSpire');
    if (!basins.length && !spires.length) return;
    const stone = new Mesher(), coping = new Mesher(), water = new Mesher(), bronze = new Mesher();
    for (const b of basins) {
      const H = b.hx, L = Math.min(LEDGE, H * 0.3), y0 = b.y, top = b.y + b.h, lh = b.h - 0.05;
      const x0 = b.x - H, x1 = b.x + H, z0 = b.z - H, z1 = b.z + H;
      const ring = (m: Mesher, ya: number, yb: number) => {
        m.box(b.x, (ya + yb) / 2, z0 + L / 2, 2 * H, yb - ya, L);
        m.box(b.x, (ya + yb) / 2, z1 - L / 2, 2 * H, yb - ya, L);
        m.box(x0 + L / 2, (ya + yb) / 2, b.z, L, yb - ya, 2 * H - 2 * L);
        m.box(x1 - L / 2, (ya + yb) / 2, b.z, L, yb - ya, 2 * H - 2 * L);
      };
      ring(stone, y0, y0 + lh);
      ring(coping, y0 + lh, top);
      stone.box(b.x, y0 + 0.03, b.z, 2 * (H - L), 0.06, 2 * (H - L));
      const wy = y0 + 0.3, a0 = H - L;
      water.quad([[b.x - a0, wy, b.z - a0], [b.x - a0, wy, b.z + a0], [b.x + a0, wy, b.z + a0], [b.x + a0, wy, b.z - a0]], [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    }
    for (const sp of spires) {
      // a turned centrepiece: stone drum plinth, three diminishing round bowls on columns (lathe), a spout finial; the lowest bowl
      // holds a stagnant puddle. Widest bowl = the collider's half size (the collider square's corners lie inside the basin).
      const R = sp.hx, y = sp.y, X = sp.x, Z = sp.z, H = sp.h;
      stone.cyl(X, y + 0.05, Z, 0.42, 0.5, 20);
      stone.add(discGeometry(X, y + 0.55, Z, 0.42, 20, true));
      const bowl = (rim: number, rimY: number, depth: number, stem: number) => {
        const t = 0.035;
        const prof = [
          new THREE.Vector2(0.001, rimY - depth - t), new THREE.Vector2(stem, rimY - depth - t), new THREE.Vector2(rim * 0.55, rimY - depth * 0.55),
          new THREE.Vector2(rim * 0.88, rimY - depth * 0.15), new THREE.Vector2(rim, rimY), new THREE.Vector2(rim - t, rimY + 0.012),
          new THREE.Vector2((rim - t) * 0.86, rimY - depth * 0.12), new THREE.Vector2((rim - t) * 0.5, rimY - depth * 0.62), new THREE.Vector2(0.001, rimY - depth + t * 0.2),
        ];
        const g = new THREE.LatheGeometry(prof, 24);
        g.translate(X, y, Z);
        bronze.add(g);
      };
      // column segments with collars between the bowls, the bowls, the spout
      bronze.cyl(X, y + 0.55, Z, 0.11, 0.2, 14);
      bowl(R, 1.0, 0.24, 0.12);
      water.add(discGeometry(X, y + 0.93, Z, R * 0.78, 24, true));
      bronze.cyl(X, y + 1.0, Z, 0.085, 0.5, 14);
      bronze.cyl(X, y + 1.3, Z, 0.12, 0.06, 14);
      bowl(R * 0.62, 1.7, 0.17, 0.09);
      bronze.cyl(X, y + 1.7, Z, 0.06, 0.3, 12);
      bowl(R * 0.34, 2.08, 0.1, 0.06);
      const sp1 = new THREE.SphereGeometry(0.075, 12, 8); sp1.translate(X, y + 2.12, Z); bronze.add(sp1);
      const sp2 = new THREE.ConeGeometry(0.045, H - 2.19, 10); sp2.translate(X, y + 2.19 + (H - 2.19) / 2, Z); bronze.add(sp2);
    }
    const lv = (basins[0] ?? spires[0]).level ?? 0;
    add(stone.mesh(this.dress.fountainStone, 'mall-fountain-stone', {level: lv}));
    add(coping.mesh(this.dress.fountainCoping, 'mall-fountain-coping', {level: lv}));
    add(water.mesh(this.dress.fountainWater, 'mall-fountain-water', {level: lv}));
    add(bronze.mesh(this.dress.fountainBronze, 'mall-fountain-bronze', {level: lv}));
    this.stats.fountains = basins.length;
  }

  /** Hanging banners in the void: from just under the springing line, avoiding bridges and the shaft. */
  private buildBanners(add: (m: THREE.Mesh | null) => void): void {
    const o = this.info.roof.outline;
    const alongX = o.x1 - o.x0 >= o.z1 - o.z0;
    const L0 = alongX ? o.x0 : o.z0, L1 = alongX ? o.x1 : o.z1, mid = alongX ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
    const n = Math.max(2, Math.min(6, Math.floor((L1 - L0) / 14)));
    const rings = this.levels.filter(l => l.id !== this.floorLevel);
    const top = this.info.roof.springY - 0.6;
    for (let i = 0; i < n; i++) {
      const l = L0 + (L1 - L0) * (i + 0.5) / n;
      for (const off of [-2.2, 2.2]) {
        const x = alongX ? l : mid + off, z = alongX ? mid + off : l;
        const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
        if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H || !this.voidCol[cy * this.W + cx]) continue;
        // the banner must clear every deck below it (bridges) by 3 m
        let floorY = -Infinity;
        for (const L of rings) { const c = L.grid.cells[cy * this.W + cx]; if (c === FLOOR) floorY = Math.max(floorY, L.grid.floorOf(cy * this.W + cx)); }
        const len = Math.min(9, top - Math.max(floorY + 3, this.topRingCeil - 12));
        if (len < 3) continue;
        const k = this.stats.banners;
        const mat = bannerMaterial(k, this.info.name, this.info.storeys.filter(q => q.role === 'ring').length, this.info.shops.filter(q => q.kind !== 'vacant' && q.kind !== 'service').length);
        const w = 1.6;
        const g = new THREE.PlaneGeometry(w, len);
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set(x, top - len / 2, z);
        mesh.rotation.y = alongX ? 0 : Math.PI / 2;
        mesh.name = `mall-banner-${k}`;
        mesh.userData.levels = this.allLevels;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        add(mesh);
        this.stats.banners++;
      }
    }
  }

  /** Escalator truss soffits: the inclined cladding under each open mall escalator (the steps are drawn by traversalBuilder). */
  private buildEscalatorSoffits(add: (m: THREE.Mesh | null) => void): void {
    const flights = mallEscalatorFlights(this.layout);
    if (!flights.length) return;
    const m = new Mesher();
    const tags = new Set<number>();
    for (const {flight, lower, upper} of flights) {
      const r = this.layout.grid.ramps[flight.ramp] ?? this.levels.find(l => l.grid.ramps[flight.ramp])?.grid.ramps[flight.ramp];
      if (!r) continue;
      const axisX = r.axis === 'x';
      const P = (s: number, a: number, y: number): [number, number, number] => (axisX ? [s, y, a] : [a, y, s]);
      const a0 = flight.a0, a1 = flight.a1, D = 0.9;
      const s0 = r.s0, s1 = r.s1;
      const y0 = rampHeight(r, s0), y1 = rampHeight(r, s1);
      const k = (y1 - y0) / (s1 - s0 || 1);
      const nl = Math.hypot(k, 1);
      const n = axisX ? [k / nl, -1 / nl, 0] : [0, -1 / nl, k / nl];
      m.quad([P(s0, a0, y0 - D), P(s1, a0, y1 - D), P(s1, a1, y1 - D), P(s0, a1, y0 - D)], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      for (const [a, sg] of [[a0, -1], [a1, 1]] as const) {
        const nn = axisX ? [0, 0, sg] : [sg, 0, 0];
        m.quad([P(s0, a, y0 - D), P(s1, a, y1 - D), P(s1, a, y1), P(s0, a, y0)], nn, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      tags.add(lower); tags.add(upper);
      this.stats.soffits++;
    }
    add(m.mesh(this.dress.soffit, 'mall-escalator-soffits', {levels: [...tags]}));
  }

  /**
   * Square downlight cans for the ring fixtures (instanced per storey; virtual daylight sources stay hidden: their matrices are
   * zero-scaled by the builder). The tube instance of each such fixture becomes the can's square lens (downlightLensMatrix), so
   * the fixture state (broken / flicker / dying) still shows on it. Returns the instance count.
   */
  buildDownlights(group: THREE.Group, lightMats: readonly THREE.Matrix4[], lights: readonly {level?: number; virtual?: boolean}[], fixture: {h: number}): number {
    const byLevel = new Map<number, THREE.Matrix4[]>();
    lights.forEach((l, i) => {
      if (!this.isDownlight(l) || l.virtual) return;
      const lv = l.level ?? 0;
      let list = byLevel.get(lv);
      if (!list) byLevel.set(lv, (list = []));
      list.push(lightMats[i]);
    });
    let n = 0;
    const geo = downlightCanGeometry(fixture.h);
    for (const [lv, list] of byLevel) {
      const im = new THREE.InstancedMesh(geo, this.dress.can, list.length);
      list.forEach((m, k) => im.setMatrixAt(k, m));
      im.name = `mall-downlights-${lv}`;
      im.userData.level = lv;
      im.computeBoundingSphere();
      group.add(im);
      n += list.length;
    }
    this.stats.downlights = n;
    return n;
  }

  /** Summary (QA / tests): finish rows, programs present, atrium stats, materials. */
  summary(): {rows: number; programs: string[]; atrium: AtriumStats; materials: string[]} {
    const mats = new Set<string>();
    for (const k of ['wall', 'floor', 'ceiling'] as const) for (const b of [false, true]) mats.add(mallSurfaceMaterial(k, b).name);
    for (const m of Object.values(this.dress)) mats.add(m.name);
    return {rows: this.rows.size, programs: [...new Set(this.info.shops.map(s => s.program))].sort(), atrium: {...this.stats}, materials: [...mats]};
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Helpers

/** Mall escalators: verticals of kind 'escalator' -> levelLinks -> traversal stair flights. */
export function mallEscalatorFlights(layout: StationLayout): {flight: {ramp: number; a0: number; a1: number}; lower: number; upper: number}[] {
  const info = layout.mall;
  if (!info) return [];
  const links = (layout as {levelLinks?: {id: number; lower: number; upper: number; traversalId?: number}[]}).levelLinks ?? [];
  const out: {flight: {ramp: number; a0: number; a1: number}; lower: number; upper: number}[] = [];
  const seen = new Set<number>();
  for (const v of info.verticals) {
    if (v.kind !== 'escalator' || v.link === undefined) continue;
    const ln = links.find(l => l.id === v.link) ?? links[v.link];
    const fl = ln?.traversalId !== undefined ? layout.traversal.stairs[ln.traversalId] : undefined;
    if (!fl || seen.has(fl.ramp)) continue;
    seen.add(fl.ramp);
    out.push({flight: fl, lower: ln!.lower, upper: ln!.upper});
  }
  return out;
}

/**
 * Largest axis-aligned rectangle of cells where `ok(x, y)` holds in a w x h window (histogram / stack method, O(w h)); ties prefer
 * the more square one. Cell coordinates, x1 / y1 exclusive; null when no cell holds.
 */
export function maxRect(w: number, h: number, ok: (x: number, y: number) => boolean): {x0: number; y0: number; x1: number; y1: number} | null {
  const hist = new Int32Array(w);
  let best: {x0: number; y0: number; x1: number; y1: number} | null = null, bestA = 0, bestS = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hist[x] = ok(x, y) ? hist[x] + 1 : 0;
    const st: number[] = [];
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hist[x] : 0;
      let start = x;
      while (st.length && hist[st[st.length - 1]] >= cur) {
        const top = st.pop()!, hh = hist[top];
        const left = st.length ? st[st.length - 1] + 1 : 0, ww = x - left;
        const a = ww * hh, sq = Math.min(ww, hh) / Math.max(ww, hh, 1);
        if (hh > 0 && (a > bestA || (a === bestA && sq > bestS))) { bestA = a; bestS = sq; best = {x0: left, y0: y - hh + 1, x1: x, y1: y + 1}; }
        start = left;
      }
      void start;
      if (x < w) st.push(x);
    }
  }
  return best;
}

/** Even-odd point-in-polygon (x / z). */
export function pointInPoly(poly: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; };

const ATLAS_W = 1024, ATLAS_CELL = 500, ATLAS_MAX_H = 2048, ATLAS_PAD = 4;
/** Atlas packing (512 px cells, rows, 2048 px pages): [page, x, y, w, h] per image + page heights. */
export function packAtlas(sizes: readonly {width: number; height: number}[]): {cells: [number, number, number, number, number][]; pages: number[]} {
  const dims = sizes.map(img => { const w = Math.min(ATLAS_CELL, Math.max(16, img.width)); return {w, h: Math.max(16, Math.round(w * img.height / Math.max(1, img.width)))}; });
  // shelf packing, tallest first (fewer wasted rows); cells keep the input order
  const order = dims.map((_, i) => i).sort((a, b) => dims[b].h - dims[a].h || a - b);
  const cells: [number, number, number, number, number][] = new Array(sizes.length);
  const pages: number[] = [];
  let page = 0, col = 0, rowY = 0, rowH = 0;
  for (const i of order) {
    const {w, h} = dims[i];
    if (col + w + 2 * ATLAS_PAD > ATLAS_W) { col = 0; rowY += rowH; rowH = 0; }
    if (rowY + h + 2 * ATLAS_PAD > ATLAS_MAX_H) { pages.push(rowY + rowH); page++; col = 0; rowY = 0; rowH = 0; }
    cells[i] = [page, col + ATLAS_PAD, rowY + ATLAS_PAD, w, h];
    col += w + 2 * ATLAS_PAD;
    rowH = Math.max(rowH, h + 2 * ATLAS_PAD);
  }
  pages.push(rowY + rowH);
  return {cells, pages: pages.map(hh => Math.max(16, Math.ceil(hh / 4) * 4))};
}

/** Sign atlas material: the builder's sign-atlas program (map sampled at uv * aUvRect.zw + aUvRect.xy per instance). */
function signAtlasMaterial(atlas: THREE.Texture): THREE.Material {
  const m = new MeshStandardNodeMaterial({map: atlas, roughness: 0.6});
  m.name = 'mall-sign-atlas';
  m.contextNode = SIGN_ATLAS_CONTEXT;
  return m;
}

const shopGlass = new WeakMap<WorldMaterials, THREE.Material>();
/**
 * Mall shopfront glass: the lit, world-mapped grimy shopfront glass (the storefronts' program; damage cracks / shatters it) a
 * little clearer than the subway kiosks'. Transparent, depth-write off: never a flashlight shadow caster. One per WorldMaterials.
 */
export function shopGlassMaterial(mats: WorldMaterials): THREE.Material {
  let m = shopGlass.get(mats);
  if (!m) {
    m = cloneSurfaceMaterial(shapeMaterial(mats, 'glassShopfront'));
    (m as SurfaceNodeMaterial).opacity = 0.34;
    m.name = 'mall-shop-glass';
    shopGlass.set(mats, m);
  }
  return m;
}

const bannerMats = new Map<string, THREE.Material>();
/** Banner cloth: alpha-tested (opaque cut-out: torn foot), double-sided, lit (one per text: name / counts per mall). */
function bannerMaterial(i: number, name: string, floors: number, shops: number): THREE.Material {
  const k = i % 6, key = `${k}|${name}|${floors}|${shops}`;
  let m = bannerMats.get(key);
  if (!m) {
    m = new SurfaceNodeMaterial({map: bannerTexture(k, name, floors, shops), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0});
    m.name = `mall-banner-${k}`;
    bannerMats.set(key, m);
  }
  return m;
}

/** Every mall material a build may use (warm-up coverage tests): surfaces + dressing + banners. */
export function mallMaterialNames(mats: WorldMaterials): string[] {
  const d = mallDressMaterials(mats);
  return [...['wall', 'floor', 'ceiling'].flatMap(k => [`mall-${k}`, `mall-${k}-boh`]), ...Object.values(d).map(m => m.name)];
}

/** Downlight can + lens matrices for a ring fixture (the builder's light matrix, fixture dims). */
export function downlightLensMatrix(m: THREE.Matrix4, fixture: {w: number; d: number}): THREE.Matrix4 {
  // the tube box is (w * 0.82) x 0.025 x (d * 0.42): scale it into a 0.28 m square lens
  const sx = 0.28 / (fixture.w * 0.82), sz = 0.28 / (fixture.d * 0.42);
  return m.clone().multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
}

/** Shared geometry of the square downlight can (0.34 x fixture h x 0.34, top at the origin). */
export function downlightCanGeometry(h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.34, h, 0.34);
  g.translate(0, -h / 2, 0);
  return g;
}

/** Height (m) of the white roof-edge beam above the top ring's ceiling, under the clerestory glazing. */
export const ROOF_BEAM = 0.6;

/** Back of house this far (m) from the void bounds is 'deep' (MallArch.deepTag): beyond the culler's atrium margin. */
export const MALL_DEEP = ATRIUM_MARGIN + 1;

/** Number of surface materials (front / back of house per kind) — bounded by construction. */
export const MALL_SURFACE_MATERIALS = 6;
/** The per-vertex attribute name (re-exported for the builder). */
export {MALL_FINISH_ATTR};

// ---------------------------------------------------------------------------------------------------------------------------
// Landmarks: fountain water, directory pylon faces (task track3, lane ARCH)

const LEDGE = FOUNTAIN.ledge;
/** Directory pylon face: size (2:3, the 320 x 480 canvases), centre height above the floor, the body depth. */
export const PYLON_FACE = {w: 0.74, h: 1.11, y: 1.22, d: PYLON.d} as const;

let waterTex: THREE.CanvasTexture | null = null;
/** Stagnant fountain water: dark green-brown, algae blooms, a scum line, floating leaves / cups / a can (one texture). */
function stagnantWaterTexture(): THREE.CanvasTexture {
  if (waterTex) return waterTex;
  waterTex = canvasTexture(256, 256, 7431, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#1e261c'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h, r = 12 + rnd() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${60 + rnd() * 30},${80 + rnd() * 30},${34 + rnd() * 20},0.55)`); g.addColorStop(1, 'rgba(40,52,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(120,118,92,0.35)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6); // scum line at the wall
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${90 + rnd() * 60},${60 + rnd() * 30},${20 + rnd() * 20},0.8)`; ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#c8c2b0'; ctx.fillRect(w * 0.62, h * 0.3, 10, 7); ctx.fillStyle = '#8a1f24'; ctx.fillRect(w * 0.3, h * 0.72, 9, 5); // a cup, a can
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 12; i++) ctx.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 30, 1);
  });
  waterTex.wrapS = waterTex.wrapT = THREE.ClampToEdgeWrapping;
  return waterTex;
}

/** A flat round disc (water surface / plinth top) at (x, y, z), facing up (indexed, normals, uvs 0..1). */
function discGeometry(x: number, y: number, z: number, r: number, seg: number, up: boolean): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Plan rectangle of a storey in world metres (its public areas, shops and the void), for the directory face. */
function storeyPlanBounds(layout: StationLayout, level: number): {x0: number; z0: number; x1: number; z1: number} {
  const b = {x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity};
  const m = layout.mall!;
  const shops = new Set(m.shops.filter(s => s.level === level).map(s => s.area));
  for (const a of layout.areas) {
    if ((a.level ?? 0) !== level || !(a.publicSpace || shops.has(a.id))) continue;
    b.x0 = Math.min(b.x0, a.x * CELL); b.z0 = Math.min(b.z0, a.y * CELL); b.x1 = Math.max(b.x1, (a.x + a.w) * CELL); b.z1 = Math.max(b.z1, (a.y + a.h) * CELL);
  }
  if (!Number.isFinite(b.x0)) return {...m.void.bounds};
  return b;
}

/**
 * The directory plan face of a pylon (canvas 320 x 480): the storey's public plan north-up — shops filled in their program's sign
 * colour, galleries / courts pale, the void dark, washrooms blue, escalators (orange arrows foot -> head), stairs, the elevator — a
 * red "You are here" dot at the pylon, a header (the mall name + the storey) and a legend; aged (yellowed, grimy).
 */
export function directoryPlanTexture(layout: StationLayout, level: number, here: {x: number; z: number}, atrium: Uint8Array | null, seed: number): THREE.CanvasTexture {
  const m = layout.mall!;
  const st = m.storeys.find(q => q.level === level);
  return canvasTexture(320, 480, seed, (ctx, W, H, rnd) => {
    ctx.fillStyle = '#efeadf'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f2b38'; ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = '#d9a520'; ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(`${m.name.toUpperCase()} · DIRECTORY`, 12, 17); // (task mall-playtest-revision: the seeded name)
    ctx.fillStyle = '#f2efe6'; ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(level === m.void.floorLevel ? 'SUBWAY · COURTS' : (st?.label ?? `Level ${level}`).toUpperCase(), 12, 45);
    // plan area
    const PX = 12, PY = 76, PW = W - 24, PH = H - 76 - 92;
    const b = storeyPlanBounds(layout, level), bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.z1 - b.z0);
    const k = Math.min(PW / bw, PH / bh), ox = PX + (PW - bw * k) / 2, oy = PY + (PH - bh * k) / 2;
    const X = (x: number) => ox + (x - b.x0) * k, Y = (z: number) => oy + (z - b.z0) * k;
    const shopBy = new Map(m.shops.filter(s => s.level === level).map(s => [s.area, s]));
    const gal = new Set(m.galleries.flatMap(g => g.areas)), bridges = new Set(m.bridges.map(q => q.area));
    for (const a of layout.areas) {
      if ((a.level ?? 0) !== level) continue;
      const s = shopBy.get(a.id);
      let fill: string | null = null;
      if (s) fill = BRAND_STYLE[s.program].bg;
      else if (/washroom/i.test(`${a.label} ${a.type}`) && a.publicSpace) fill = '#9fc6d8';
      else if (gal.has(a.id) || bridges.has(a.id) || (a.publicSpace && a.kind !== 'platform')) fill = '#d6d0c2';
      else if (a.kind === 'platform') fill = '#bdb6a6';
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(X(a.x * CELL), Y(a.y * CELL), a.w * CELL * k, a.h * CELL * k);
      if (s) { ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(X(a.x * CELL) + 0.5, Y(a.y * CELL) + 0.5, a.w * CELL * k - 1, a.h * CELL * k - 1); }
    }
    // the void (dark) on the rings; the pit storey's atrium shows as the platforms under it
    if (level !== m.void.floorLevel) {
      const o = m.void.openings?.find(q => q.level === level)?.outline ?? m.void.outline; // (task mall-playtest-revision: this floor's opening)
      ctx.fillStyle = '#2a3a52';
      ctx.beginPath(); o.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)))); ctx.closePath(); ctx.fill();
      for (const br of m.bridges.filter(q => q.level === level)) { ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = Math.max(2, br.width * k); ctx.beginPath(); ctx.moveTo(X(br.from.x), Y(br.from.z)); ctx.lineTo(X(br.to.x), Y(br.to.z)); ctx.stroke(); }
    }
    void atrium;
    // runs touching this storey: escalators orange, stairs grey (arrow foot -> head)
    const arrow = (ax: number, az: number, bx: number, bz: number, col: string) => {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(ax), Y(az)); ctx.lineTo(X(bx), Y(bz)); ctx.stroke();
      const ang = Math.atan2(Y(bz) - Y(az), X(bx) - X(ax));
      ctx.beginPath(); ctx.moveTo(X(bx), Y(bz)); ctx.lineTo(X(bx) - 7 * Math.cos(ang - 0.5), Y(bz) - 7 * Math.sin(ang - 0.5)); ctx.lineTo(X(bx) - 7 * Math.cos(ang + 0.5), Y(bz) - 7 * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
    };
    for (const v of m.verticals) {
      if (v.lower !== level && v.upper !== level) continue;
      if (v.kind === 'escalator') arrow(v.foot.x, v.foot.z, v.head.x, v.head.z, '#e0702a');
      else if (v.kind === 'stair') arrow(v.foot.x, v.foot.z, v.head.x, v.head.z, '#5a5a5a');
    }
    for (const e of m.elevators) {
      ctx.fillStyle = '#3a7fc1'; ctx.fillRect(X(e.shaft.x0), Y(e.shaft.z0), (e.shaft.x1 - e.shaft.x0) * k, (e.shaft.z1 - e.shaft.z0) * k);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('E', X((e.shaft.x0 + e.shaft.x1) / 2), Y((e.shaft.z0 + e.shaft.z1) / 2)); ctx.textAlign = 'left';
    }
    // task mall-playtest-revision (station-return wayfinding): the way back to the Subway from this storey (lane GEN's
    // wayfinding[].stationReturn: its first step's stand point), dashed from the pylon
    const ret = m.wayfinding?.find(q => q.level === level)?.stationReturn?.[0];
    if (ret) {
      ctx.save();
      ctx.strokeStyle = '#d23c3c'; ctx.lineWidth = 3; ctx.setLineDash?.([6, 4]);
      ctx.beginPath(); ctx.moveTo(X(here.x), Y(here.z)); ctx.lineTo(X(ret.at.x), Y(ret.at.z)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#d23c3c'; ctx.beginPath(); ctx.arc(X(ret.at.x), Y(ret.at.z), 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(`TO SUBWAY ▼ (${ret.kind})`, Math.min(W - 120, X(ret.at.x) + 8), Math.min(PY + PH - 4, Y(ret.at.z) + 14));
    }
    // you are here
    const hx = X(here.x), hy = Y(here.z);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d23c3c'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif'; ctx.fillStyle = '#d23c3c';
    ctx.fillText('YOU ARE HERE', Math.min(W - 92, hx + 9), Math.max(PY + 8, hy - 9));
    // legend
    const LY = H - 84;
    ctx.fillStyle = '#1f2b38'; ctx.fillRect(0, LY - 6, W, 2);
    const legend: [string, string][] = [['#e0702a', 'Escalators'], ['#5a5a5a', 'Stairs'], ['#3a7fc1', 'Elevator'], ['#9fc6d8', 'Washrooms'], ['#2a3a52', 'Atrium'], ['#d23c3c', 'You are here']];
    ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
    legend.forEach(([c, t], i) => { const lx = 12 + (i % 2) * 150, ly = LY + 8 + Math.floor(i / 2) * 22; ctx.fillStyle = c; ctx.fillRect(lx, ly - 6, 14, 12); ctx.fillStyle = '#2a2a2a'; ctx.fillText(t, lx + 20, ly); });
    // 30 years: yellowed, grime from the bottom, scratches
    ctx.fillStyle = 'rgba(160,130,60,0.12)'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, 'rgba(40,34,26,0)'); g.addColorStop(1, 'rgba(40,34,26,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); const x = rnd() * W, y = rnd() * H; ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 40); ctx.stroke(); }
  });
}

/** The brand directory face of a pylon (canvas 320 x 480): this storey's stores with a program colour chip, aged. */
export function directoryListTexture(layout: StationLayout, level: number, seed: number): THREE.CanvasTexture {
  const m = layout.mall!;
  const shops = m.shops.filter(s => s.level === level && s.program !== 'vacant').sort((a, b) => a.brand.localeCompare(b.brand));
  return canvasTexture(320, 480, seed, (ctx, W, H, rnd) => {
    ctx.fillStyle = '#efeadf'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f2b38'; ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = '#d9a520'; ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('STORES ON THIS LEVEL', 12, 17);
    const st = m.storeys.find(q => q.level === level);
    ctx.fillStyle = '#f2efe6'; ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(level === m.void.floorLevel ? 'SUBWAY · COURTS' : (st?.label ?? `Level ${level}`).toUpperCase(), 12, 45);
    const rows = Math.max(1, shops.length), rh = Math.min(26, (H - 90) / rows);
    ctx.font = `${Math.max(10, Math.round(rh * 0.6))}px "Helvetica Neue", Arial, sans-serif`;
    shops.forEach((s, i) => {
      const y = 80 + i * rh + rh / 2;
      ctx.fillStyle = BRAND_STYLE[s.program].bg; ctx.fillRect(12, y - rh * 0.35, rh * 0.7, rh * 0.7);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(12.5, y - rh * 0.35 + 0.5, rh * 0.7 - 1, rh * 0.7 - 1);
      ctx.fillStyle = '#23272b'; ctx.fillText(s.brand, 20 + rh * 0.7, y);
      ctx.fillStyle = '#6a6458'; ctx.textAlign = 'right'; ctx.fillText(s.program.replace('-', ' '), W - 12, y); ctx.textAlign = 'left';
    });
    if (!shops.length) { ctx.fillStyle = '#6a6458'; ctx.fillText('Platforms · Fountain court · South court', 12, 100); }
    ctx.fillStyle = 'rgba(160,130,60,0.12)'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 18; i++) { ctx.fillStyle = `rgba(40,34,26,${0.04 + rnd() * 0.08})`; ctx.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3); }
  });
}
