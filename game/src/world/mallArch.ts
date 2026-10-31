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
import {abs, cameraPosition, clamp, dot, float, floor, fract, max, min, mix, normalWorld, normalize, positionLocal, positionWorld, smoothstep, step, uv, vec2, vec3} from 'three/tsl';
import {CELL, FLOOR, VOID, rampHeight} from '../gen/grid';
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
}
const dressCache = new WeakMap<WorldMaterials, MallDressMaterials>();

/** Distance (in pane units) to the nearest pane edge of a unit grid at q. */
const edge01 = (q: AnyNode): AnyNode => { const f = fract(q) as AnyNode; return min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())); };

/**
 * Roof glazing: unlit (it is lit from outside: the overcast sky behind it), transparent, depth-write off, double-sided. UVs are
 * metres (u along the vault, v around the arch): glazing bars every 1.5 x 1.2 m (opaque), panes tinted green-grey, a third of
 * them grimy (30 years of dirt), ~5 % broken out (open to the sky), grazing views more reflective (fresnel).
 */
function roofGlass(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide});
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
  const pane = mix(vec3(0.62, 0.7, 0.66), vec3(0.4, 0.4, 0.34), grime.mul(2.2));
  m.colorNode = mix(pane, vec3(0.78, 0.8, 0.78), bar);
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

/** Overcast sky seen through the vault: an unlit green-grey dome (the outside murk, gen/office DAYLIGHT lore), no fog. */
function skyMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({side: THREE.BackSide, fog: false, depthWrite: false});
  m.name = 'mall-sky';
  const d = normalize(positionLocal as AnyNode) as AnyNode;
  const t = clamp(d.y, 0, 1);
  const n = wmHash(vec3(floor(d.x.mul(9)), floor(d.z.mul(9)), 3)) as AnyNode;
  m.colorNode = mix(vec3(0.36, 0.42, 0.37), vec3(0.6, 0.65, 0.6), t.pow(0.6)).mul(n.mul(0.06).add(0.97));
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
    sky: skyMaterial(),
    can: named(surfaceMaterial('paintedPanel', {color: 0xdedcd6, roughness: 1}, {macro: 0.05}), 'mall-downlight-can'),
    trimLight: named(thinTrim(surfaceMaterial('paintedPanel', {color: 0xd8d6d0, roughness: 1}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-light'),
    trimDark: named(thinTrim(surfaceMaterial('paintedSteel', {color: 0x2e3032, metalness: 0.3}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-dark'),
    trimWood: named(thinTrim(surfaceMaterial('woodVeneer', {color: 0xc8a888, roughness: 1}, {grime: [0.2, 0.4], macro: 0.1})), 'mall-trim-wood'),
    soffit: named(surfaceMaterial('paintedPanel', {color: 0xe6e4de, roughness: 1}, {macro: 0.06}), 'mall-escalator-soffit'),
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

/** Hanging banner (vertical, torn foot: alpha cut-out): the mall's name or a faded event. */
function bannerTexture(i: number): THREE.CanvasTexture {
  const texts = ["THE EATON'S CENTER", 'SPRING · SALE', 'SIX LEVELS · 200 SHOPS', 'OPEN LATE', "THE EATON'S CENTER", 'GRAND REOPENING'];
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
  readonly dress: MallDressMaterials;
  stats: AtriumStats = {meshes: 0, triangles: 0, roofPanes: 0, arches: 0, balustradeM: 0, balustradeRuns: 0, columns: 0, signs: 0, blades: 0, labels: 0, banners: 0, downlights: 0, shaftPanels: 0, soffits: 0, droppedFaces: 0, glazing: 0, shutters: 0, partialShutters: 0, ms: 0};

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
    const poly = info.void.outline, b = info.void.bounds;
    for (let i = 0; i < n; i++) {
      const c = gf.cells[i];
      if (c !== FLOOR && c !== VOID) continue;
      if (gf.rampIdx[i] < 0 && cellCeil(gf, i) >= spring - 0.5) this.voidCol[i] = 1;
      const cx = i % this.W, cy = (i - cx) / this.W, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && (poly.length < 3 || pointInPoly(poly, x, z))) this.atrium[i] = 1;
    }
    // plaza courts: public, non-platform areas of the pit-bottom storey near the void (their own ring centre each)
    const vb = info.void.bounds, pad = 10;
    for (const a of layout.areas) {
      if ((a.level ?? 0) !== levels[this.floorLevel]?.id || !a.publicSpace || a.kind === 'platform' || this.shopByArea.has(a.id) || this.galleryAreas.has(a.id)) continue;
      const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
      if (x1 < vb.x0 - pad || x0 > vb.x1 + pad || z1 < vb.z0 - pad || z0 > vb.z1 + pad) continue;
      this.plazaCenter.set(a.id, {x: (x0 + x1) / 2, z: (z0 + z1) / 2});
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

  /** Whether the open cell in front of a face (plane + normal * CELL / 2) is a void column. */
  private frontIsVoid(f: FaceLike): boolean {
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const mx = alongX ? (f.x0 + f.x1) / 2 : f.x0 + f.nx * CELL / 2;
    const mz = alongX ? f.z0 + f.nz * CELL / 2 : (f.z0 + f.z1) / 2;
    const cx = Math.floor(mx / CELL), cy = Math.floor(mz / CELL);
    return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H && this.atrium[cy * this.W + cx] === 1;
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
    for (const f of faces) {
      const isFloor = f.level === this.floorLevel;
      const up = /tileUpper/.test(f.finish) && f.vb0 !== undefined ? {vb0: f.vb0 - tileLowerHeight, vb1: (f.vb1 ?? f.vb0) - tileLowerHeight} : {};
      if (this.onShaft(f)) { this.stats.droppedFaces++; continue; }
      if (isFloor && this.frontIsVoid(f)) {
        if (f.y1 <= 3.0) { out.push(f); continue; } // the platform edge / bed walls under the atrium: the station's own
        // above ring 6: a white roof-edge beam, then the glazed clerestory up to the springing line and the vault (buildRoof)
        const beamTop = this.topRingCeil + ROOF_BEAM;
        if (f.y0 >= beamTop - 0.02 || f.y0 >= spring - 0.02) { this.stats.droppedFaces++; continue; }
        const y1 = Math.min(f.y1, f.y0 >= this.topRingCeil - 0.05 ? beamTop : spring + 0.05);
        out.push({...f, finish: this.wallKey({space: 'gallery', ring: 0}, true), y1, vb0: f.y0, vb1: f.y0, openings: f.openings.filter(o => o.top > f.y0)});
        continue;
      }
      const a = f.area >= 0 ? this.layout.areas[f.area] : undefined;
      const sp = this.spaceOf(f.area, f.level);
      if (sp.space === 'station') { out.push(f); continue; }
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
      if (top >= spring - 0.5 && this.inVoidOutline(i)) return false;
    }
    if (lvl.id === this.floorLevel && i !== undefined && this.atrium[i]) return `mall-ceil|${this.row('c', SPACE_FINISH.galleryCeil)}`; // bridge soffits over the pit
    const sp = this.spaceOf(areaId, lvl.id);
    if (sp.space === 'station') return null;
    const boh = MallArch.boh(sp);
    const tag = boh && i !== undefined ? this.deepTag((i % this.W + 0.5) * CELL, (Math.floor(i / this.W) + 0.5) * CELL) : '';
    return `mall-ceil${boh ? `-boh${tag}` : ''}|${this.row('c', this.finishOf(sp).ceil)}`;
  }

  /** Whether grid cell i lies inside the void outline bounds (the vault's footprint). */
  private inVoidOutline(i: number): boolean {
    const cx = i % this.W, cy = (i - cx) / this.W;
    const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL, b = this.info.roof.outline;
    return x >= b.x0 - 0.01 && x <= b.x1 + 0.01 && z >= b.z0 - 0.01 && z <= b.z1 + 0.01;
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

  /** The glass barrel vault, steel arches, purlins, edge girders, gable fans, the roof deck ring and the sky dome. */
  private buildRoof(add: (m: THREE.Mesh | null) => void): void {
    const R = this.info.roof, o = R.outline;
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
        const nl = Math.hypot(mx / half, my / rise) || 1;
        const nA = -(mx / (half * half)), nY = -(my / (rise * rise)); // inward normal of the ellipse
        const nn = Math.hypot(nA, nY) || 1;
        void nl;
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
    // purlins (glazing rails) along the vault at every other arch segment, the ridge, and the edge girders at the springing
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
    // the clerestory: glazing on every void outline edge from the roof-edge beam (over ring 6's ceiling) up to the springing line,
    // mullions every 1.5 m, a ledge plate at the springing line over the cells between the (stepped) outline and the vault's rect
    const yB = this.topRingCeil + ROOF_BEAM;
    const out = this.info.void.outline;
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
    const up = [0, 1, 0];
    const ledge = new Mesher();
    for (let cy = Math.floor(o.z0 / CELL); cy < Math.ceil(o.z1 / CELL); cy++) {
      for (let cx = Math.floor(o.x0 / CELL); cx < Math.ceil(o.x1 / CELL);) {
        const inside = (x: number) => x < this.W && cy >= 0 && cy < this.H && !this.atrium[cy * this.W + x];
        if (cx < 0 || !inside(cx)) { cx++; continue; }
        let e = cx + 1;
        while (e < Math.ceil(o.x1 / CELL) && inside(e)) e++;
        const ax = Math.max(o.x0, cx * CELL), bx = Math.min(o.x1, e * CELL), az = Math.max(o.z0, cy * CELL), bz = Math.min(o.z1, (cy + 1) * CELL);
        ledge.quad([[ax, R.springY, az], [ax, R.springY, bz], [bx, R.springY, bz], [bx, R.springY, az]], [0, -1, 0], [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
        ledge.quad([[ax, R.springY + 0.01, az], [ax, R.springY + 0.01, bz], [bx, R.springY + 0.01, bz], [bx, R.springY + 0.01, az]], up, [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
        cx = e;
      }
    }
    // the building's roof deck around the void (membrane) at the beam top, seen through the clerestory / vault glass
    const yD = yB + 0.02, ring = 12;
    const x0 = o.x0 - ring, x1 = o.x1 + ring, z0 = o.z0 - ring, z1 = o.z1 + ring;
    for (const [ax, az, bx, bz] of [[x0, z0, x1, o.z0], [x0, o.z1, x1, z1], [x0, o.z0, o.x0, o.z1], [o.x1, o.z0, x1, o.z1]]) {
      deck.quad([[ax, yD, az], [ax, yD, bz], [bx, yD, bz], [bx, yD, az]], up, [[ax, az], [ax, bz], [bx, bz], [bx, az]]);
    }
    const all = this.allLevels;
    add(glass.mesh(this.dress.glassRoof, 'mall-roof-glass', {levels: all}));
    add(steel.mesh(this.dress.whiteSteel, 'mall-roof-steel', {levels: all}));
    add(deck.mesh(this.dress.membrane, 'mall-roof-deck', {levels: all}));
    add(ledge.mesh(this.dress.whiteSteel, 'mall-roof-ledge', {levels: all}));
    // the overcast sky dome over the vault (unlit, never fogged, only seen through the glass)
    const dome = new THREE.SphereGeometry(190, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const sky = new THREE.Mesh(dome, this.dress.sky);
    sky.position.set((o.x0 + o.x1) / 2, this.topRingCeil, (o.z0 + o.z1) / 2);
    sky.name = 'mall-sky';
    sky.userData.levels = all;
    sky.renderOrder = -5;
    sky.matrixAutoUpdate = false;
    sky.updateMatrix();
    add(sky);
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

  /** Steel-frame glass shaft towers: glazing on every atrium-facing side, corner posts, storey girts, the machine head. */
  private buildShaftTowers(add: (m: THREE.Mesh | null) => void): void {
    if (!this.info.elevators.length) return;
    const glass = new Mesher(), frame = new Mesher();
    for (const e of this.info.elevators) {
      const s = e.shaft;
      const ys = e.stops.map(q => q.y).sort((a, b) => a - b);
      const y0 = Math.min(ys[0] ?? 0, this.gridOf(this.floorLevel).floorAt((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)), yTop = (ys[ys.length - 1] ?? 0) + 3.4;
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
      // machine head on top
      frame.box((s.x0 + s.x1) / 2, yTop + 0.6, (s.z0 + s.z1) / 2, s.x1 - s.x0 + 0.3, 1.2, s.z1 - s.z0 + 0.3);
      // the pit floor and the cap under the machine head (seen through the glass: never an empty shaft)
      frame.box((s.x0 + s.x1) / 2, y0 - 0.05, (s.z0 + s.z1) / 2, s.x1 - s.x0, 0.1, s.z1 - s.z0);
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
    // Level labels on the void fascias: on the longest outline edges, facing into the void, two per edge
    const out = this.info.void.outline;
    const rings = this.info.storeys.filter(s => s.role === 'ring');
    const edges = out.map((a, i) => ({a, b: out[(i + 1) % out.length]})).map(e => ({...e, len: Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z)})).sort((p, q2) => q2.len - p.len).slice(0, 2);
    for (const st of rings) {
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
          const cx = Math.floor((px + nx * 0.3) / CELL), cy = Math.floor((pz + nz * 0.3) / CELL);
          if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H || !this.voidCol[cy * this.W + cx]) { nx = -nx; nz = -nz; }
          const ix = Math.floor((px + nx * 0.3) / CELL), iy = Math.floor((pz + nz * 0.3) / CELL);
          if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H || !this.voidCol[iy * this.W + ix]) continue;
          const yaw = Math.atan2(nx, nz);
          face(tex, new THREE.Matrix4().compose(new THREE.Vector3(px + nx * 0.025, st.baseY - 0.12 - hgt / 2, pz + nz * 0.025), q.setFromAxisAngle(UP, yaw), new THREE.Vector3(hgt * 3.2, hgt, 1)), st.level);
          this.stats.labels++;
        }
      }
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
        const mat = bannerMaterial(k);
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

const bannerMats: THREE.Material[] = [];
/** Banner cloth: alpha-tested (opaque cut-out: torn foot), double-sided, lit. */
function bannerMaterial(i: number): THREE.Material {
  const k = i % 6;
  if (!bannerMats[k]) {
    const m = new SurfaceNodeMaterial({map: bannerTexture(k), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0});
    m.name = `mall-banner-${k}`;
    bannerMats[k] = m;
  }
  return bannerMats[k];
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
