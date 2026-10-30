// Iteration 16 (WORLD-GEN) / seamless (GEN): builder support for the office level (layout.office v2, gen/office/*: ONE layout,
// tower storeys = levels 1..8). Called from world/builder.ts buildWorld through three anchored hooks; nothing here runs for the
// Subway (no layout.office, no office prop kinds). Every surface / cut is per storey (its level grid, its baseY, userData.level).
//
//  - cutOfficeWindows: the perimeter wall ring stays SOLID in the grid (collision / bullets / sight / light field stop there);
//    the window SPANS are cut out of the built wall faces (left / right / below-sill / above-head pieces), so lane TOWER's glass
//    shows the exterior. The reveals (sill top, head soffit, jambs) over the 0.5 m wall thickness are built here too.
//  - buildOfficeProp: office furniture kinds (gen/office/kinds.ts) render with lane ASSETS' Meshy models when they are loaded
//    (preloadOfficeAssets → a module cache read synchronously while building), turned from the files' -Z front to the prop
//    frame's +Z and fitted to the prop box; otherwise their procedural box forms. Cubicle partitions are always geometry
//    (fabric panel per placement + a metal cap). Inside office sections the `desk` holder renders as the Meshy office desk.
//  - buildOfficeSurfaces: carpet over the office floors and a drop ceiling under the office ceilings (Codex textures T1 / T2 when
//    loaded, else procedural canvas textures), the window reveals. Node standard materials: lit by the baked light field.
// Everything is created before the section's warm-up (it is in the scene when prepareGraphics runs).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {CELL, FLOOR} from '../gen/grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import {propShape, type ShapeMat} from '../gen/propShapes';
import {OFFICE_KIND_ASSET, isOfficeKind, officeKindAsset, officeModelKey, officeShape} from '../gen/office/kinds';
import type {StationLayout} from '../gen/stationTypes';
import {loadOfficeAsset, loadOfficeTexture, type OfficeAssetId, type OfficeTextureId} from '../assets/officeAssets';
import {canvasTexture} from './canvasTextures';
import {shapeMaterials} from './shapeMaterials';
import type {WorldMaterials, MatKey} from './materials';

type Fit = {w: number; h: number; d: number; anchor: 'bottom' | 'top'};
type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: Fit, name: string) => number;

// ---------------------------------------------------------------------------------------------
// Asset cache (filled by preloadOfficeAssets, read synchronously by the builder)

const models = new Map<string, GLTF>();
const textures = new Map<OfficeTextureId, THREE.Texture>();

/**
 * Loads the office models / textures a layout uses (Promise; never rejects). Register it as a section preload
 * (game.sectionPreloads) so the synchronous build finds them; a missing / failed file keeps its procedural fallback.
 */
export async function preloadOfficeAssets(layout: StationLayout, opts: {models?: boolean} = {}): Promise<void> {
  if (!layout.office) return;
  const ids = new Set<OfficeAssetId>();
  // The Game loads the models through propModels (officeModelKeysFor); it preloads only the textures here (models: false).
  if (opts.models !== false) for (const p of layout.props) {
    const id = (OFFICE_KIND_ASSET as Readonly<Record<string, string | undefined>>)[p.kind] as OfficeAssetId | undefined;
    if (id) ids.add(id);
  }
  const texIds: OfficeTextureId[] = ['office-carpet', 'ceiling-tile', 'cubicle-fabric'];
  await Promise.all([
    ...[...ids].map(async id => { const g = await loadOfficeAsset(id); if (g) models.set(id, g); }),
    ...texIds.map(async id => { const t = await loadOfficeTexture(id); if (t) textures.set(id, t); }),
  ]);
}

/** Office kinds (and `desk` inside office sections) this module renders. */
export function isOfficeBuilt(kind: PropKind, layout: StationLayout): boolean {
  return isOfficeKind(kind) || (kind === 'desk' && !!layout.office);
}

const sizes = new WeakMap<GLTF, THREE.Vector3>();
function modelSize(g: GLTF): THREE.Vector3 {
  let v = sizes.get(g);
  if (!v) { g.scene.updateMatrixWorld(true); v = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()); sizes.set(g, v); }
  return v;
}

const UP = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

function mergeBoxGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nPos = 0, nIdx = 0;
  for (const g of list) { nPos += g.attributes.position.count; nIdx += g.index ? g.index.count : 0; }
  const pos = new Float32Array(nPos * 3), nor = new Float32Array(nPos * 3), uv = new Float32Array(nPos * 2), idx = new Uint32Array(nIdx);
  let po = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, po * 3);
    nor.set(g.attributes.normal.array as Float32Array, po * 3);
    uv.set(g.attributes.uv.array as Float32Array, po * 2);
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + po;
    po += g.attributes.position.count; io += ix.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], name: string, level: number): number {
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.name = name;
  im.userData.level = level;
  im.computeBoundingSphere();
  group.add(im);
  return mats.length;
}

/** Renders one office kind's placements (models when loaded, else box forms). Returns the instance count. */
export function buildOfficeProp(group: THREE.Group, kind: PropKind, list: PropPlacement[], wm: WorldMaterials, layout: StationLayout, instanceModel: InstanceModel,
  lib: Record<string, GLTF | undefined> = {}): number {
  if (!list.length) return 0;
  // Procedural instances are grouped per storey (the level culler hides storeys behind slabs); models chunk via levelAt.
  const levels = new Set(list.map(p => p.level ?? 0));
  if (levels.size > 1) {
    let n = 0;
    for (const lv of levels) n += buildOfficeProp(group, kind, list.filter(p => (p.level ?? 0) === lv), wm, layout, instanceModel, lib);
    return n;
  }
  const level = list[0].level ?? 0;
  void layout;
  if (kind === 'cubiclePartition') return partitions(group, list, wm, level);
  // Task office-overhaul-20261030 (lane TENANTS): company / supporting kinds map to lane ASSETS' company models (companyAssets.ts
  // COMPANY_MODEL_FILES, the same `office-<assetId>` library keys, loaded before entry via officeModelKeysFor); box forms until then.
  const asset = officeKindAsset(kind);
  // The game's lazy prop library (office-<assetId> keys, ASSETS' OFFICE_MODEL_FILES) first, then this module's preload cache.
  const gltf = asset ? lib[officeModelKey(asset)] ?? models.get(asset as OfficeAssetId) : undefined;
  const def = PROP_DEFS[kind];
  if (gltf) {
    // The derivatives are at real size and the footprints are their measured bounds: a uniform fit to the footprint keeps the
    // proportions (the desk's 0.77 m work top stays the `desk` loot surface; its privacy panel rises behind it).
    const size = modelSize(gltf);
    const k = Math.min(def.w / size.x, def.d / size.z);
    const fit = k > 0 && Number.isFinite(k) ? {w: size.x * k, h: size.y * k, d: size.z * k, anchor: 'bottom' as const} : {w: def.w, h: def.h, d: def.d, anchor: 'bottom' as const};
    return instanceModel(group, gltf, list.map(p => placeM(p).multiply(FLIP)), fit, kind);
  }
  const parts = isOfficeKind(kind) ? officeShape(kind) : propShape(kind);
  if (!parts) return 0;
  const pm = shapeMaterials(wm);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const b = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    if (p.rx) b.rotateX(p.rx);
    b.translate(p.p[0], p.p[1], p.p[2]);
    let l = byMat.get(p.m);
    if (!l) byMat.set(p.m, (l = []));
    l.push(b);
  }
  const placements = list.map(placeM);
  for (const [m, geos] of byMat) instanced(group, mergeBoxGeos(geos), pm[m], placements, `prop-${kind}-${m}`, level);
  return list.length;
}

let fabricMat: THREE.Material | null = null;
let fabricKey: THREE.Texture | null | undefined;
function partitions(group: THREE.Group, list: PropPlacement[], wm: WorldMaterials, level: number): number {
  const tex = textures.get('cubicle-fabric') ?? null;
  if (!fabricMat || fabricKey !== tex) {
    fabricMat = new MeshStandardNodeMaterial({color: tex ? 0xffffff : 0x5d6773, roughness: 0.95, metalness: 0, map: tex ?? undefined});
    fabricMat.name = 'office-partition-fabric';
    fabricKey = tex;
  }
  const panel = new THREE.BoxGeometry(1, 1, 1);
  panel.translate(0, 0.5, 0);
  const cap = new THREE.BoxGeometry(1, 0.03, 1);
  cap.translate(0, 0.015, 0);
  const pm: THREE.Matrix4[] = [], cm: THREE.Matrix4[] = [];
  for (const p of list) {
    const sx = Math.max(0.05, p.hx * 2 - 0.02), sz = Math.max(0.05, p.hz * 2 - 0.02);
    pm.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(sx, p.h - 0.03, sz)));
    cm.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + p.h - 0.03, p.z), new THREE.Quaternion(), new THREE.Vector3(sx + 0.01, 1, sz + 0.01)));
  }
  instanced(group, panel, fabricMat, pm, 'prop-cubiclePartition', level);
  instanced(group, cap, shapeMaterials(wm).steelDark, cm, 'prop-cubiclePartition-cap', level);
  return list.length;
}

// ---------------------------------------------------------------------------------------------
// Window cuts

interface FaceLike {
  level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  openings: {s0: number; s1: number; top: number}[]; slope?: unknown; finish: string;
  /** Face normal (toward the open side), when known. */
  nx?: number; nz?: number;
}

/** Height of the elevator doorway through the shaft wall above each stop (lane LIFT's LIFT_DOOR_H; the cells stay SOLID). */
export const SHAFT_DOOR_H = 2.2;

/**
 * Seamless office: the elevator doorway of every stop is cut out of the landing-side face of the (SOLID) shaft wall as a regular
 * face opening (door width x SHAFT_DOOR_H above the stop floor, lintel above), so lane LIFT's linings / leaves / architrave show
 * through. Faces of other storeys and planes are untouched.
 */
export function cutOfficeShaftDoors<F extends FaceLike>(faces: F[], layout: Pick<StationLayout, 'office'>): F[] {
  const e = layout.office?.elevator;
  if (!e?.stops?.length) return faces;
  const alongX = e.doorSide === 'N' || e.doorSide === 'S';
  const plane = e.doorSide === 'N' ? e.shaft.z0 : e.doorSide === 'S' ? e.shaft.z1 : e.doorSide === 'W' ? e.shaft.x0 : e.shaft.x1;
  const out = e.doorSide === 'N' || e.doorSide === 'W' ? -1 : 1;
  const c = alongX ? e.door.x : e.door.z, d0 = c - e.door.width / 2, d1 = c + e.door.width / 2;
  const stops = new Map(e.stops.map(q => [q.levelId, q.y]));
  return faces.map(f => {
    const y = stops.get(f.level);
    if (y === undefined || f.slope) return f;
    const fAlongX = Math.abs(f.z0 - f.z1) < 1e-9;
    if (fAlongX !== alongX || Math.abs((fAlongX ? f.z0 : f.x0) - plane) > 1e-6) return f;
    const n = fAlongX ? f.nz : f.nx;
    if (n !== undefined && Math.sign(n) !== out) return f;
    const a0 = Math.min(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1), a1 = Math.max(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1);
    const s0 = Math.max(a0, d0), s1 = Math.min(a1, d1), top = y + SHAFT_DOOR_H;
    if (s1 - s0 < 1e-4 || f.y0 >= top - 1e-4 || f.y1 <= y + 1e-4) return f;
    return {...f, openings: [...f.openings, {s0: s0 - a0, s1: s1 - a0, top: Math.min(top, f.y1)}]};
  });
}

/** Cuts the office window spans out of the built wall faces (the facade's inner face planes) of each span's storey (and the shaft doorways). */
export function cutOfficeWindows<F extends FaceLike>(faces: F[], layout: Pick<StationLayout, 'office'>): F[] {
  const info = layout.office;
  if (!info) return faces;
  // The builder's single office face hook: the shaft doorways too.
  let out = info.elevator ? cutOfficeShaftDoors(faces, layout) : faces;
  if (!info.windows?.length) return out;
  for (const w of info.windows) {
    const lv = w.level, base = w.baseY;
    const alongX = w.side === 'N' || w.side === 'S';
    const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
    const s0 = alongX ? w.x0 : w.z0, s1 = alongX ? w.x1 : w.z1;
    const ya = base + w.sill, yb = base + w.head;
    const next: F[] = [];
    for (const f of out) {
      const fAlongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const fPlane = fAlongX ? f.z0 : f.x0;
      const fs0 = Math.min(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1), fs1 = Math.max(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1);
      if (f.level !== lv || fAlongX !== alongX || Math.abs(fPlane - plane) > 1e-6 || f.slope || f.openings.length
        || fs1 <= s0 + 1e-6 || fs0 >= s1 - 1e-6 || f.y1 <= ya + 1e-6 || f.y0 >= yb - 1e-6) { next.push(f); continue; }
      const piece = (a: number, b: number, y0: number, y1: number) => {
        if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
        next.push({...f, ...(fAlongX ? {x0: a, x1: b} : {z0: a, z1: b}), y0, y1, openings: []});
      };
      const c0 = Math.max(fs0, s0), c1 = Math.min(fs1, s1);
      piece(fs0, c0, f.y0, f.y1);
      piece(c1, fs1, f.y0, f.y1);
      piece(c0, c1, f.y0, Math.min(f.y1, ya));
      piece(c0, c1, Math.max(f.y0, yb), f.y1);
    }
    out = next;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Surfaces: carpet, drop ceiling, window reveals

class Quads {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: readonly number[], uv: number[][]): void {
    // Wind counter-clockwise as seen from the normal side whatever the axis order the caller used.
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const dot = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
    if (dot < 0) { p = [p[0], p[3], p[2], p[1]]; uv = [uv[0], uv[3], uv[2], uv[1]]; }
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uv[i]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  mesh(mat: THREE.Material, name: string, level: number): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.userData.level = level;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

const CARPET_TYPES = new Set(['office-open', 'office-room', 'office-corridor']);
const surfaceMats = new Map<string, THREE.Material>();
function surfaceMat(key: 'carpet' | 'carpetDark' | 'ceilingTile', tex: THREE.Texture | undefined): THREE.Material {
  const k = `${key}:${tex ? tex.uuid : 'proc'}`;
  let m = surfaceMats.get(k);
  if (m) return m;
  const map = tex ?? procTexture(key);
  m = new MeshStandardNodeMaterial({map: map ?? undefined, color: map ? (key === 'carpetDark' ? 0xb8b8b8 : 0xffffff) : key === 'ceilingTile' ? 0xbdbab0 : 0x4b5563, roughness: key === 'ceilingTile' ? 0.9 : 0.98, metalness: 0});
  m.name = `office-${key}`;
  surfaceMats.set(k, m);
  return m;
}

const procTex = new Map<string, THREE.Texture | null>();
function procTexture(key: string): THREE.Texture | null {
  if (procTex.has(key)) return procTex.get(key)!;
  let t: THREE.Texture | null = null;
  try {
    if (typeof document !== 'undefined') {
      t = key === 'ceilingTile'
        ? canvasTexture(256, 256, 1601, (ctx, w, h) => {
          ctx.fillStyle = '#c9c5b8'; ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(90,80,60,${Math.random() * 0.05})`; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
          ctx.fillStyle = '#8f8d86'; ctx.fillRect(0, 0, w, 5); ctx.fillRect(0, 0, 5, h);
        })
        : canvasTexture(256, 256, 1602, (ctx, w, h) => {
          ctx.fillStyle = '#56606b'; ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 2600; i++) { const v = 60 + Math.random() * 50; ctx.fillStyle = `rgba(${v},${v + 8},${v + 18},0.35)`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
    }
  } catch { t = null; }
  procTex.set(key, t);
  return t;
}

/** Carpet, drop ceilings and window reveals of every tower storey of the office level. Returns the mesh count. */
export function buildOfficeSurfaces(group: THREE.Group, layout: StationLayout, wm: WorldMaterials): number {
  const info = layout.office;
  if (!info) return 0;
  // Without a section preload (preloadOfficeAssets) the first office build uses the procedural textures; warm the cache for the next.
  for (const id of ['office-carpet', 'ceiling-tile', 'cubicle-fabric'] as const) if (!textures.has(id)) void loadOfficeTexture(id).then(t => { if (t) textures.set(id, t); });
  let n = 0;
  const add = (m: THREE.Mesh | null) => { if (m) { group.add(m); n++; } };
  const CARPET_M = 2.0, TILE_M = 1.2;
  for (const st of info.storeys) {
    const L = layout.levels[st.levelId];
    if (!L) continue;
    const g = L.grid, lv = L.id;
    const carpet = new Quads(), carpetDark = new Quads(), ceil = new Quads();
    const typeAt = (i: number) => layout.areas[g.area[i]]?.type ?? '';
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w;) {
        const i = g.idx(x, y);
        const t = typeAt(i);
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || !CARPET_TYPES.has(t) || (layout.areas[g.area[i]]?.level ?? 0) !== lv) { x++; continue; }
        const f = g.floorOf(i), c = g.ceil[i], a = g.area[i];
        let e = x + 1;
        while (e < g.w) {
          const j = g.idx(e, y);
          if (g.cells[j] !== FLOOR || g.rampIdx[j] >= 0 || g.area[j] !== a || Math.abs(g.floorOf(j) - f) > 1e-4 || Math.abs(g.ceil[j] - c) > 1e-4) break;
          e++;
        }
        const x0 = x * CELL, x1 = e * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
        const q = t === 'office-corridor' ? carpetDark : carpet;
        const yf = f + 0.006;
        q.quad([[x0, yf, z0], [x0, yf, z1], [x1, yf, z1], [x1, yf, z0]], [0, 1, 0], [[x0 / CARPET_M, z0 / CARPET_M], [x0 / CARPET_M, z1 / CARPET_M], [x1 / CARPET_M, z1 / CARPET_M], [x1 / CARPET_M, z0 / CARPET_M]]);
        const yc = c - 0.004;
        ceil.quad([[x0, yc, z0], [x1, yc, z0], [x1, yc, z1], [x0, yc, z1]], [0, -1, 0], [[x0 / TILE_M, z0 / TILE_M], [x1 / TILE_M, z0 / TILE_M], [x1 / TILE_M, z1 / TILE_M], [x0 / TILE_M, z1 / TILE_M]]);
        x = e;
      }
    }
    add(carpet.mesh(surfaceMat('carpet', textures.get('office-carpet')), 'office-carpet', lv));
    add(carpetDark.mesh(surfaceMat('carpetDark', textures.get('office-carpet')), 'office-carpet-corridor', lv));
    add(ceil.mesh(surfaceMat('ceilingTile', textures.get('ceiling-tile')), 'office-drop-ceiling', lv));
  }
  // Window reveals over the wall thickness (painted plaster; the entrance gets a concrete threshold), one mesh per storey.
  const sc = wm.scale.paint;
  const byLevel = new Map<number, {rev: Quads; thr: Quads}>();
  for (const w of info.windows) {
    let q = byLevel.get(w.level);
    if (!q) byLevel.set(w.level, (q = {rev: new Quads(), thr: new Quads()}));
    const {rev, thr} = q;
    const ya = w.baseY + w.sill, yb = w.baseY + w.head;
    const alongX = w.side === 'N' || w.side === 'S';
    const [i0, i1] = alongX ? [w.z0, w.z1] : [w.x0, w.x1];
    const [s0, s1] = alongX ? [w.x0, w.x1] : [w.z0, w.z1];
    const P = (s: number, y: number, d: number): number[] => (alongX ? [s, y, d] : [d, y, s]);
    const uvs = (a: number, b: number, c: number, d: number) => [[a / sc.u, b / sc.v], [c / sc.u, b / sc.v], [c / sc.u, d / sc.v], [a / sc.u, d / sc.v]];
    // Head soffit (faces down) and sill top (faces up).
    rev.quad([P(s0, yb, i0), P(s1, yb, i0), P(s1, yb, i1), P(s0, yb, i1)], [0, -1, 0], uvs(s0, i0, s1, i1));
    (w.sill > 0.01 ? rev : thr).quad([P(s0, ya, i1), P(s1, ya, i1), P(s1, ya, i0), P(s0, ya, i0)], [0, 1, 0], uvs(s0, i0, s1, i1));
    // Jambs (face the opening's centre).
    for (const [s, sgn] of [[s0, 1], [s1, -1]] as const) {
      const nrm = alongX ? [sgn, 0, 0] : [0, 0, sgn];
      rev.quad([P(s, ya, i0), P(s, ya, i1), P(s, yb, i1), P(s, yb, i0)], nrm, uvs(i0, ya, i1, yb));
    }
  }
  for (const [lv, {rev, thr}] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    add(rev.mesh(wm.get('paint' as MatKey), 'office-window-reveals', lv));
    add(thr.mesh(wm.get('concrete' as MatKey), 'office-entrance-threshold', lv));
  }
  return n;
}
