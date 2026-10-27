// Loot holders in the world: searchable cabinets/crates (doors and lid animate) plus open loot
// surfaces placed by the layout (shelf units, kiosk stalls, vending machines, tables). Contents are
// rolled once per station (items/loot.ts) and shown as REAL item models resting on the holder's
// surfaces (items/lootLayout.ts placements, world/lootDisplay.ts instancing): aim at an item and
// press [E] to take it, or [E] on the holder body to take everything that fits. Nothing is
// collected invisibly; leftovers from a full inventory stay where they are.
//
// Door/lid pieces are derived at RUNTIME from the existing generated derivatives; the GLB files
// are never modified. Cabinets: triangles whose centroids lie inside the door rectangle and a
// thin front slab become door geometry, split left/right at the measured seam and hinged on the
// outer vertical edges; stray interior triangles behind the doors are dropped and an authored
// interior box stands in for the inside. The interior shelving is the generated shelving unit
// (`models.shelf`, when present) fitted into the cabinet (items/lootLayout.ts cabinetInsert),
// tinted toward the cabinet's own paint so inside and outside match; without it, procedural
// boards + posts at the same tier heights. Crates: triangles above a height threshold become the
// lid, hinged at the back-top edge. This partition is APPROXIMATE (the AI reconstruction has no
// real door parts). Collision is unchanged: props stay solid AABBs; open doors are visual only.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as propsModule from '../gen/props';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {cutSurfaces} from '../gen/props07';
import {FLOOR, type Grid} from '../gen/grid';
import type {StationLayout} from '../gen/station';
import {rayAabb} from '../combat/hitscan';
import type {Inventory} from '../items/inventory';
import {itemDims} from '../items/items';
import {
  HOLDER_LABEL, createHolderState, holderPrompt, isContainerKind, isLootHolderKind, lotEntries, lotPrompt,
  nextHolderAction, openMessage, remainingCount, takeAll, takeLot, transferMessage,
  type ContainerKind, type HolderKind, type HolderState, type Lot, type SurfaceKind, type TransferResult,
} from '../items/loot';
import {
  CABINET_SPECS, DEFAULT_SHELF, cabinetInsert, cabinetInterior, holderSurfaces, placementBox,
  type Dims, type ShelfInfo, type Surface, type SurfaceOptions,
} from '../items/lootLayout';
import type {WorldMaterials} from './materials';
import {surface} from './canvasTextures';
import {LotDisplay, type LotInstance} from './lootDisplay';
import {cloneWithShaderHooks} from '../render/shaderHooks';
import {itemModelSources} from './pickups';
import {holderBoxes} from '../physics/holderShapes';

/**
 * Lid split for the generated crate model (`models.crate`, assets/models/crate.glb): triangles
 * whose centroid is above this fraction of the fitted crate height become the lid. 0.817 is the
 * seam groove measured on the derivative (lidSplitY 0.353 m of 0.432 m, props-iteration02.json).
 * The placeholder crate ignores it and uses a 7 cm lid.
 */
export const CRATE_LID_SPLIT_Y = 0.817;

/** Reach for [E] on holders (eye to hit point, meters). */
export const CONTAINER_REACH = 2.1;
/** Reach for aimed items (slightly longer: they sit inside/behind the holder front). */
export const LOT_REACH = 2.35;
/** Items are drawn only within this distance of the player (fog hides them well before). */
export const LOT_VIEW_DIST = 24;
const LOT_MARGIN = 0.03;
const REFRESH = 0.15;
const PRY_TIME = 1.1;
const OPEN_TIME = 0.45;
const CLOSE_TIME = 0.35;
const DOOR_ANGLE = THREE.MathUtils.degToRad(100);
// Crates sit 3 cm from a wall with the hinge at the back; much past vertical clips the wall.
const LID_ANGLE = THREE.MathUtils.degToRad(95);
const PLACEHOLDER_LID = 0.07;

/** Lane-contract provisional dims for layout-lane props that may not be in PROP_DEFS yet. */
const FALLBACK_DIMS: Partial<Record<SurfaceKind, Dims>> = {
  shelf: {w: 1.2, d: 0.45, h: 1.85}, stall: {w: 2.4, d: 1.2, h: 2.4}, vending: {w: 0.95, d: 0.85, h: 1.85}, table: {w: 1.4, d: 1.6, h: 0.76}, desk: {w: 1.5, d: 0.75, h: 0.76},
  shopCounter: {w: 1.5, d: 0.75, h: 1.05}, shopDisplay: {w: 1.5, d: 0.75, h: 1.745}, shopBackbar: {w: 1.77, d: 0.7, h: 1.83}, shopCooler: {w: 0.75, d: 0.75, h: 2.0},
};

const optional = propsModule as unknown as Record<string, unknown>;
const numList = (v: unknown): number[] | undefined => (Array.isArray(v) && v.length && v.every(x => typeof x === 'number') ? v as number[] : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** [z0, z1] from either a pair or a centre value (gen/props.ts exports the centre). */
const zRange = (v: unknown, halfDepth: number): [number, number] | undefined => {
  const l = numList(v);
  if (l && l.length === 2) return [Math.min(l[0], l[1]), Math.max(l[0], l[1])];
  const c = num(v);
  return c === undefined ? undefined : [c - halfDepth, c + halfDepth];
};

function holderDims(kind: HolderKind): Dims {
  return (PROP_DEFS as unknown as Record<string, Dims | undefined>)[kind] ?? FALLBACK_DIMS[kind as SurfaceKind] ?? {w: 1, d: 1, h: 1};
}

/** Shelving-unit tiers: gen/props.ts SHELF_TIER_Y (layout lane, measured by the asset lane) or the contract default. */
export function shelfInfo(): ShelfInfo {
  const d = (PROP_DEFS as unknown as Record<string, Dims | undefined>).shelf ?? DEFAULT_SHELF;
  return {tierY: numList(optional.SHELF_TIER_Y) ?? DEFAULT_SHELF.tierY, w: d.w, d: d.d, h: d.h};
}

function surfaceOptions(): SurfaceOptions {
  return {
    shelf: shelfInfo(),
    stallCounterY: num(optional.STALL_COUNTER_Y),
    stallBackShelfY: numList(optional.STALL_BACK_SHELF_Y),
    stallCounterZ: zRange(optional.STALL_COUNTER_Z, 0.16),
    stallBackShelfZ: zRange(optional.STALL_BACK_SHELF_Z, 0.13),
    tableTopY: num(optional.TABLE_TOP_Y),
    tableTopD: num(optional.TABLE_TOP_D),
  };
}

/** Average base colour of a material (texture mean × colour factor, linear). Null if unknown. */
function averageColor(mat: THREE.Material | undefined): THREE.Color | null {
  const m = mat as THREE.MeshStandardMaterial | undefined;
  if (!m || !m.isMeshStandardMaterial) return null;
  const base = m.color.clone();
  const img = m.map?.image as (CanvasImageSource & {width?: number}) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return base;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d', {willReadFrequently: true})!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      // Skip transparent and near-black texels (unused atlas background).
      if (px[i + 3] < 128 || px[i] + px[i + 1] + px[i + 2] < 15) continue;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    if (!n) return base;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace).multiply(base);
  } catch {
    return base;
  }
}

function firstMaterial(gltf: GLTF | undefined): THREE.Material | undefined {
  let out: THREE.Material | undefined;
  gltf?.scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!out && mesh.isMesh) out = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  });
  return out;
}

// Iteration 04 (Lane C): interiors/door backs/shelving get the shared worn painted-sheet texture (mesh UVs; doors move).
const std = (color: THREE.Color | number, roughness: number, metalness: number, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshStandardMaterial({color, roughness, metalness, side, map: surface('paintedPanel').map});

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }
interface LeafDef {
  /** Geometry in hinge-local space. */
  parts: Part[];
  /** Inner face of the door/lid (hinge-local), shown only while open. */
  plate: THREE.BufferGeometry | null;
  pivot: THREE.Vector3;
  axis: 'x' | 'y';
  /** Signed full-open angle. */
  angle: number;
}
interface ContainerModel {
  body: Part[];
  leaves: LeafDef[];
  plateMat: THREE.Material;
  /** Interior box (rendered back-side) + shelving/rim, shown only while open. */
  interior: Part[];
  extras: Part[];
  source: string;
  /** How the interior shelving was made (QA/report). */
  insert: string;
  /** Owned materials (disposed with the cache). */
  owned: THREE.Material[];
}

/** A loot holder in the world (cabinet, cupboard, crate, shelf, kiosk, vending machine, table). */
export interface Holder {
  /** 'container' holders have doors/lids; 'surface' holders are open (vending: once pried). */
  group: 'container' | 'surface';
  /** Index within its group, in layout order (loot seed key; QA aimContainer index). */
  index: number;
  /** Unique within the station (display ids). */
  serial: number;
  kind: HolderKind;
  prop: PropPlacement;
  state: HolderState;
  surfaces: Surface[];
  /** Holder-local → world. */
  matrix: THREE.Matrix4;
  root: THREE.Group | null;
  hinges: {obj: THREE.Object3D; axis: 'x' | 'y'; angle: number}[];
  leafMeshes: THREE.Mesh[];
  /** Interior pieces hidden while fully closed (no draw calls for closed containers). */
  inner: THREE.Object3D[];
  /** Door animation 0 closed … 1 open. */
  t: number;
  /** Vending: > 0 while being pried open. */
  pryT: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** World transform and (margin-expanded) AABB per lot id. */
  lotMats: Map<number, THREE.Matrix4>;
  lotBoxes: Map<number, THREE.Box3>;
  /** Lots were visible at the last refresh (door open etc.). */
  shown: boolean;
  /**
   * Iteration 06 (Lane D): smashed by gunfire (crate splintered apart). Its finite lots stay where
   * they fell, visible and takeable; it can no longer be closed.
   */
  broken?: boolean;
}
/** Back-compat name (iteration 02). */
export type Container = Holder;

export interface ContainerEvent {
  /** open: doors/lid start opening or a vending machine gives way. close. search: prying started. take. */
  type: 'open' | 'close' | 'search' | 'take';
  container: Holder;
  result?: TransferResult;
  message?: string;
  warn?: boolean;
}

/** What [E] would act on: an aimed item (`lot`) or the holder body. */
export interface ContainerTarget { container: Holder; t: number; lot: Lot | null }

// ---------------------------------------------------------------------------------------
// Geometry helpers

/** Triangle soup: 3 vertices per triangle, `stride` floats per vertex laid out as `attrs`. */
interface Soup { attrs: {name: string; size: number; offset: number}[]; stride: number; data: Float32Array }

/** Copies a mesh geometry into a soup transformed by `m` (reads interleaved GLB data too). */
function toSoup(src: THREE.BufferGeometry, m: THREE.Matrix4): Soup {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const attrs: Soup['attrs'] = [];
  let stride = 0;
  for (const [name, a] of Object.entries(src.attributes)) { attrs.push({name, size: a.itemSize, offset: stride}); stride += a.itemSize; }
  const n = src.index ? src.index.count : src.attributes.position.count;
  const flip = m.determinant() < 0;
  const data = new Float32Array(n * stride);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const corner = flip && i % 3 ? (i % 3 === 1 ? i + 1 : i - 1) : i; // keep winding if mirrored
    const vi = src.index ? src.index.getX(corner) : corner;
    const o = i * stride;
    for (const at of attrs) {
      const a = src.attributes[at.name];
      for (let c = 0; c < at.size; c++) data[o + at.offset + c] = a.getComponent(vi, c);
      if (at.name === 'position') v.fromArray(data, o + at.offset).applyMatrix4(m).toArray(data, o + at.offset);
      else if (at.name === 'normal') v.fromArray(data, o + at.offset).applyMatrix3(nm).normalize().toArray(data, o + at.offset);
      else if (at.name === 'tangent') v.fromArray(data, o + at.offset).transformDirection(m).toArray(data, o + at.offset);
    }
  }
  return {attrs, stride, data};
}

interface Plane { axis: 0 | 1 | 2; value: number }

/** Sutherland-Hodgman split of a convex polygon by an axis plane (attributes interpolated). */
function clipPoly(poly: Float32Array[], o: number, value: number, stride: number, nOff: number): Float32Array[][] {
  const below: Float32Array[] = [], above: Float32Array[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[o] - value, db = b[o] - value;
    (da < 0 ? below : above).push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      const v = new Float32Array(stride);
      for (let k = 0; k < stride; k++) v[k] = a[k] + (b[k] - a[k]) * t;
      v[o] = value;
      if (nOff >= 0) { const l = Math.hypot(v[nOff], v[nOff + 1], v[nOff + 2]) || 1; v[nOff] /= l; v[nOff + 1] /= l; v[nOff + 2] /= l; }
      below.push(v);
      above.push(v);
    }
  }
  return [below, above].filter(p => p.length >= 3);
}

/**
 * Cuts every triangle along the axis planes, then sends each piece to bucket
 * classify(centroid, faceNormalZ) (-1 drops it). Exact cuts keep door/lid edges straight even
 * though the simplified meshes have large triangles spanning the seams.
 */
function partition(s: Soup, planes: Plane[], region: THREE.Box3, buckets: number, classify: (c: THREE.Vector3, nz: number) => number): number[][] {
  const out: number[][] = Array.from({length: buckets}, () => []);
  const {stride, data} = s;
  const P = s.attrs.find(a => a.name === 'position')!.offset;
  const N = s.attrs.find(a => a.name === 'normal')?.offset ?? -1;
  const c = new THREE.Vector3();
  for (let base = 0; base < data.length; base += 3 * stride) {
    const tri = [0, 1, 2].map(k => data.subarray(base + k * stride, base + (k + 1) * stride));
    const [a, b, d] = tri;
    const ux = b[P] - a[P], uy = b[P + 1] - a[P + 1], uz = b[P + 2] - a[P + 2];
    const vx = d[P] - a[P], vy = d[P + 1] - a[P + 1], vz = d[P + 2] - a[P + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nzr = ux * vy - uy * vx;
    const nz = nzr / (Math.hypot(nx, ny, nzr) || 1);
    let polys: Float32Array[][] = [tri];
    // Only triangles touching the region of interest are cut; the rest are classified whole.
    const touches = Math.max(a[P], b[P], d[P]) >= region.min.x && Math.min(a[P], b[P], d[P]) <= region.max.x
      && Math.max(a[P + 1], b[P + 1], d[P + 1]) >= region.min.y && Math.min(a[P + 1], b[P + 1], d[P + 1]) <= region.max.y
      && Math.max(a[P + 2], b[P + 2], d[P + 2]) >= region.min.z && Math.min(a[P + 2], b[P + 2], d[P + 2]) <= region.max.z;
    for (const pl of touches ? planes : []) {
      const o = P + pl.axis;
      const lo = Math.min(a[o], b[o], d[o]), hi = Math.max(a[o], b[o], d[o]);
      if (!(lo < pl.value && hi > pl.value)) continue;
      polys = polys.flatMap(poly => clipPoly(poly, o, pl.value, stride, N));
    }
    for (const poly of polys) {
      c.set(0, 0, 0);
      for (const v of poly) c.set(c.x + v[P], c.y + v[P + 1], c.z + v[P + 2]);
      const bucket = classify(c.divideScalar(poly.length), nz);
      if (bucket < 0) continue;
      const dst = out[bucket];
      for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) for (let k = 0; k < stride; k++) dst.push(v[k]);
    }
  }
  return out;
}

/** Non-indexed geometry from soup data, translated by -origin. */
function soupGeometry(s: Soup, data: number[], origin?: THREE.Vector3): THREE.BufferGeometry {
  const n = data.length / s.stride;
  const g = new THREE.BufferGeometry();
  for (const at of s.attrs) {
    const arr = new Float32Array(n * at.size);
    for (let i = 0; i < n; i++) for (let c = 0; c < at.size; c++) arr[i * at.size + c] = data[i * s.stride + at.offset + c];
    if (at.name === 'position' && origin) for (let i = 0; i < n; i++) { arr[i * 3] -= origin.x; arr[i * 3 + 1] -= origin.y; arr[i * 3 + 2] -= origin.z; }
    g.setAttribute(at.name, new THREE.BufferAttribute(arr, at.size));
  }
  g.computeBoundingSphere();
  return g;
}

/** Fitted meshes of a GLB: same fit as builder.addInstancedModel (footprint w/h/d, base at y=0). */
function fittedMeshes(gltf: GLTF, w: number, h: number, d: number): {soup: Soup; mat: THREE.Material}[] {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fitM = new THREE.Matrix4().makeScale(w / size.x, h / size.y, d / size.z).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const out: {soup: Soup; mat: THREE.Material}[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    out.push({soup: toSoup(mesh.geometry, new THREE.Matrix4().multiplyMatrices(fitM, mesh.matrixWorld)), mat});
  });
  return out;
}

function boxGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, origin?: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2 - (origin?.x ?? 0), (y0 + y1) / 2 - (origin?.y ?? 0), (z0 + z1) / 2 - (origin?.z ?? 0));
  return g;
}

/** Flat frame covering the cut wall thickness at the crate opening (outer rect minus hole). */
function rimGeo(ox: number, oz: number, ix: number, iz: number, y: number): THREE.BufferGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-ox, -oz), new THREE.Vector2(ox, -oz), new THREE.Vector2(ox, oz), new THREE.Vector2(-ox, oz)]);
  s.holes.push(new THREE.Path([new THREE.Vector2(-ix, -iz), new THREE.Vector2(-ix, iz), new THREE.Vector2(ix, iz), new THREE.Vector2(ix, -iz)]));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** Holder-local transform of a placed lot: resting position, yaw, then lie-down orientation. */
function lotLocalMatrix(l: Lot): THREE.Matrix4 {
  const d = itemDims(l.itemId);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(UP, l.yaw), new THREE.Vector3(1, 1, 1));
  if (l.orient === 'side') m.multiply(new THREE.Matrix4().makeTranslation(d.h / 2, d.w / 2, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  else if (l.orient === 'back') m.multiply(new THREE.Matrix4().makeTranslation(0, d.d / 2, d.h / 2)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  return m;
}

export class ContainerManager {
  readonly group = new THREE.Group();
  /** Cabinets, cupboards and crates (doors/lids). */
  readonly list: Holder[] = [];
  /** Shelves, kiosks, vending machines, tables. */
  readonly surfaces: Holder[] = [];
  /** Every loot holder of the station. */
  readonly all: Holder[] = [];
  /** Feedback hook (toasts/sfx live in game.ts). */
  onEvent: ((e: ContainerEvent) => void) | null = null;
  private readonly cache = new Map<ContainerKind, ContainerModel>();
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly rimMat = new THREE.MeshStandardMaterial({color: 0x6b5640, roughness: 0.95, map: surface('woodVeneer').map});
  private readonly hiMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private readonly display = new LotDisplay();
  private highlighted: Holder | null = null;
  private highlightLot = -1;
  private readonly lastEye = new THREE.Vector3();
  private refreshT = 0;
  private dirty = true;

  constructor(private readonly models: Record<string, GLTF | undefined>, private readonly mats: WorldMaterials, private readonly inventory: () => Inventory) {
    this.group.name = 'containers';
    this.group.add(this.display.group);
  }

  // --- models ---------------------------------------------------------------------------
  private model(kind: ContainerKind): ContainerModel {
    let m = this.cache.get(kind);
    if (!m) {
      m = kind === 'crate' ? this.crateModel() : this.cabinetModel(kind);
      this.cache.set(kind, m);
    }
    return m;
  }

  private crateSplitY(): number {
    const h = PROP_DEFS.crate.h;
    return this.models.crate ? CRATE_LID_SPLIT_Y * h : h - PLACEHOLDER_LID;
  }

  private cabinetModel(kind: 'cabinetTall' | 'cabinetLow'): ContainerModel {
    const def = PROP_DEFS[kind], spec = CABINET_SPECS[kind];
    const gltf = this.models[kind];
    const {hw, y0, y1, zBack, zCut} = cabinetInterior(kind, def);
    const zFront = def.d / 2;
    const seam = spec.doors === 2 ? spec.seam * def.w / 2 : Infinity;
    if (!gltf) {
      // No derivative loaded (should not happen; the loader fails loudly) — plain steel box.
      const geo = boxGeo(-def.w / 2, 0, -def.d / 2, def.w / 2, def.h, def.d / 2);
      return {body: [{geo, mat: this.mats.get('steel')}], leaves: [], plateMat: this.rimMat, interior: [], extras: [], source: 'placeholder box', insert: 'none', owned: []};
    }
    // Inside matches outside: the interior, door backs and shelving take the cabinet's own paint.
    const paint = averageColor(firstMaterial(gltf)) ?? new THREE.Color(0x3a3d38);
    const interiorMat = std(paint.clone().multiplyScalar(0.42), 0.92, 0.2, THREE.BackSide);
    const plateMat = std(paint.clone().multiplyScalar(0.6), 0.85, 0.25);
    const body: Part[] = [];
    const doorParts: Part[][] = [[], []];
    const doorData: {soup: Soup; data: number[]; mat: THREE.Material}[][] = [[], []];
    const frontZs: number[] = [];
    const planes: Plane[] = [{axis: 0, value: -hw}, {axis: 0, value: hw}, {axis: 1, value: y0}, {axis: 1, value: y1}, {axis: 2, value: zCut}, {axis: 2, value: zBack - 0.005}];
    if (spec.doors === 2) planes.push({axis: 0, value: seam});
    for (const {soup, mat} of fittedMeshes(gltf, def.w, def.h, def.d)) {
      const region = new THREE.Box3(new THREE.Vector3(-hw, y0, zBack - 0.005), new THREE.Vector3(hw, y1, Infinity));
      const [keep, left, right] = partition(soup, planes, region, 3, (c, nz) => {
        const inRect = Math.abs(c.x) < hw && c.y > y0 && c.y < y1;
        if (inRect && c.z > zCut) {
          if (nz > 0.8) frontZs.push(c.z);
          return c.x < seam ? 1 : 2;
        }
        // Stray interior surfaces between the doors and the back wall would float inside the
        // opened cabinet; drop them (the outer back face, facing -Z, is kept).
        if (inRect && c.z > zBack - 0.005 && !(nz < -0.6 && c.z < zBack + 0.05)) return -1;
        return 0;
      });
      body.push({geo: soupGeometry(soup, keep), mat});
      [left, right].forEach((data, i) => { if (data.length) doorData[i].push({soup, data, mat}); });
    }
    frontZs.sort((a, b) => a - b);
    // Hinge on the outer front edge (90th percentile of the door's front-facing surface).
    const hingeZ = frontZs.length ? frontZs[Math.floor(frontZs.length * 0.9)] : zFront;
    const leaves: LeafDef[] = [];
    const ranges = spec.doors === 2 ? [[-hw, seam], [seam, hw]] : [[-hw, hw]];
    ranges.forEach(([xa, xb], i) => {
      if (!doorData[i].length) return;
      const right = spec.doors === 2 && i === 1;
      const pivot = new THREE.Vector3(right ? hw : -hw, 0, hingeZ);
      for (const dd of doorData[i]) doorParts[i].push({geo: soupGeometry(dd.soup, dd.data, pivot), mat: dd.mat});
      leaves.push({
        parts: doorParts[i],
        plate: boxGeo(xa + 0.004, y0 + 0.004, zCut - 0.012, xb - 0.004, y1 - 0.004, zCut - 0.002, pivot),
        pivot, axis: 'y', angle: right ? DOOR_ANGLE : -DOOR_ANGLE,
      });
    });
    const interior: Part[] = [{geo: boxGeo(-hw + 0.004, y0 + 0.004, zBack, hw - 0.004, y1 - 0.004, zCut - 0.004), mat: interiorMat}];
    const insert = this.cabinetInsertParts(kind, def, paint);
    return {
      body, leaves, plateMat, interior, extras: insert.parts, owned: [interiorMat, plateMat, ...insert.owned],
      source: `models.${kind}: runtime door split (approximate)`, insert: insert.source,
    };
  }

  /** The shelving inside a cabinet: generated shelf unit fitted per items/lootLayout.ts, or boards. */
  private cabinetInsertParts(kind: 'cabinetTall' | 'cabinetLow', def: Dims, paint: THREE.Color): {parts: Part[]; owned: THREE.Material[]; source: string} {
    const info = shelfInfo();
    const ins = cabinetInsert(kind, def, info);
    const {zBack, zCut, y1} = cabinetInterior(kind, def);
    const shelf = this.models.shelf;
    if (shelf) {
      const parts: Part[] = [];
      const owned: THREE.Material[] = [];
      const tinted = new Map<THREE.Material, THREE.Material>();
      const cutY = ins.sections[0].cutY;
      for (const {soup, mat} of fittedMeshes(shelf, info.w, info.h, info.d)) {
        let data: number[];
        if (cutY < info.h - 1e-3) {
          const all = new THREE.Box3(new THREE.Vector3(-Infinity, -Infinity, -Infinity), new THREE.Vector3(Infinity, Infinity, Infinity));
          [data] = partition(soup, [{axis: 1, value: cutY}], all, 1, c => (c.y < cutY ? 0 : -1));
        } else data = Array.from(soup.data);
        if (!data.length) continue;
        const geos = ins.sections.map(s => {
          const g = soupGeometry(soup, data);
          g.applyMatrix4(new THREE.Matrix4().makeTranslation(s.cx, s.y0, s.zMid).multiply(new THREE.Matrix4().makeScale(s.w / info.w, s.sy, s.depth / info.d)));
          return g;
        });
        const geo = geos.length > 1 ? mergeGeometries(geos, false) ?? geos[0] : geos[0];
        if (geo !== geos[0] || geos.length > 1) for (const g of geos) if (g !== geo) g.dispose();
        geo.computeBoundingSphere();
        let m = tinted.get(mat);
        if (!m) {
          // Tint the shelf's own texture toward the cabinet paint so the insert matches the exterior.
          const c = (mat as THREE.MeshStandardMaterial).clone();
          const avg = averageColor(mat);
          if (avg && c.isMeshStandardMaterial) {
            const k = (a: number, b: number) => Math.max(0.35, Math.min(2.2, a / Math.max(1e-3, b)));
            c.color.multiply(new THREE.Color(k(paint.r, avg.r), k(paint.g, avg.g), k(paint.b, avg.b)));
          }
          tinted.set(mat, (m = c));
          owned.push(c);
        }
        parts.push({geo, mat: m});
      }
      if (parts.length) return {parts, owned, source: `models.shelf fitted: ${ins.sections.length} section(s), cut at ${cutY.toFixed(2)} m, tiers ${ins.tiers.map(t => t.toFixed(2)).join('/')} m, tinted to cabinet paint`};
    }
    // Fallback: boards + corner posts at the same tier heights, in the cabinet's paint.
    const boardMat = std(paint.clone().multiplyScalar(0.85), 0.75, 0.35);
    const geos: THREE.BufferGeometry[] = [];
    for (const s of ins.sections) {
      const x0 = s.cx - s.w / 2 + 0.006, x1 = s.cx + s.w / 2 - 0.006;
      for (const t of ins.tiers) geos.push(boxGeo(x0, t - 0.018, zBack + 0.006, x1, t, zCut - 0.02));
      for (const x of [x0 + 0.012, x1 - 0.012]) for (const z of [zBack + 0.02, zCut - 0.035]) geos.push(boxGeo(x - 0.011, s.y0, z - 0.011, x + 0.011, y1 - 0.006, z + 0.011));
    }
    const geo = mergeGeometries(geos.map(g => g.toNonIndexed()), false);
    for (const g of geos) g.dispose();
    return {parts: [{geo, mat: boardMat}], owned: [boardMat], source: `procedural boards (no models.shelf), tiers ${ins.tiers.map(t => t.toFixed(2)).join('/')} m, cabinet paint`};
  }

  private crateModel(): ContainerModel {
    const def = PROP_DEFS.crate;
    const gltf = this.models.crate;
    const body: Part[] = [], lid: Part[] = [];
    const splitY = this.crateSplitY();
    let source: string;
    if (gltf) {
      const pivot = new THREE.Vector3(0, splitY, -def.d / 2 + 0.01);
      for (const {soup, mat} of fittedMeshes(gltf, def.w, def.h, def.d)) {
        const all = new THREE.Box3(new THREE.Vector3(-Infinity, -Infinity, -Infinity), new THREE.Vector3(Infinity, Infinity, Infinity));
        const [keep, top] = partition(soup, [{axis: 1, value: splitY}], all, 2, c => (c.y > splitY ? 1 : 0));
        body.push({geo: soupGeometry(soup, keep), mat});
        if (top.length) lid.push({geo: soupGeometry(soup, top, pivot), mat});
      }
      source = `models.crate: runtime lid split at CRATE_LID_SPLIT_Y=${CRATE_LID_SPLIT_Y} × height (approximate)`;
    } else {
      // Placeholder crate (no generated model yet): open-topped box + separate 7 cm lid.
      const mat = this.mats.get('crate');
      const geo = new THREE.BoxGeometry(def.w, splitY, def.d);
      geo.translate(0, splitY / 2, 0);
      const top = geo.groups[2]; // BoxGeometry face order px, nx, py, ny, pz, nz: drop +Y
      const idx = Array.from(geo.index!.array);
      idx.splice(top.start, top.count);
      geo.setIndex(idx);
      geo.clearGroups();
      body.push({geo, mat});
      const lidGeo = new THREE.BoxGeometry(def.w + 0.012, PLACEHOLDER_LID, def.d + 0.012);
      lidGeo.translate(0, PLACEHOLDER_LID / 2, def.d / 2 - 0.01);
      lid.push({geo: lidGeo, mat});
      source = 'placeholder crate (procedural box + lid)';
    }
    const wood = averageColor(firstMaterial(gltf)) ?? new THREE.Color(0x3b2f22);
    const interiorMat = std(wood.clone().multiplyScalar(0.38), 0.95, 0, THREE.BackSide);
    const pivot = new THREE.Vector3(0, splitY, -def.d / 2 + 0.01);
    const inset = Math.max(0.025, 0.05 * Math.min(def.w, def.d));
    const ix = def.w / 2 - inset, iz = def.d / 2 - inset;
    return {
      body,
      leaves: lid.length ? [{parts: lid, pivot, axis: 'x', angle: -LID_ANGLE,
        plate: boxGeo(-def.w / 2 + 0.012, splitY + 0.001, -def.d / 2 + 0.012, def.w / 2 - 0.012, splitY + 0.007, def.d / 2 - 0.012, pivot)}] : [],
      plateMat: this.rimMat,
      interior: [{geo: boxGeo(-ix, 0.06 * def.h, -iz, ix, splitY - 0.002, iz), mat: interiorMat}],
      extras: [{geo: rimGeo(def.w / 2 - 0.002, def.d / 2 - 0.002, ix, iz, splitY - 0.001), mat: this.rimMat}],
      source, insert: 'none (crate)', owned: [interiorMat],
    };
  }

  // --- station lifecycle ----------------------------------------------------------------
  build(layout: StationLayout): void {
    this.clear();
    const opts = surfaceOptions();
    const placements = new Map<ContainerKind, THREE.Matrix4[]>();
    const counts = new Map<string, number>();
    let ci = 0, si = 0;
    for (const p of layout.props) {
      const kind = p.kind as string;
      if (!isLootHolderKind(kind)) continue;
      const isC = isContainerKind(kind);
      const def = holderDims(kind);
      // Iteration 07 (Lane P2): spans taken by on-top decor (register, lamp ...) are not loot surface.
      const surfaces = cutSurfaces(holderSurfaces(kind, def, {...opts, crateSplitY: this.crateSplitY()}), p.cut);
      // Iteration 05 (Lane R): the holder's purpose (prop override, else its room/store purpose)
      // keys the loot table (gen/purposes.ts); plain halls keep their room type.
      const area = layout.areas[p.area];
      const areaType = p.purpose ?? area?.purpose ?? area?.type ?? 'default';
      const index = isC ? ci++ : si++;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
      const h: Holder = {
        group: isC ? 'container' : 'surface', index, serial: this.all.length, kind, prop: p,
        state: createHolderState(layout.seed, index, kind, areaType, surfaces), surfaces, matrix,
        root: null, hinges: [], leafMeshes: [], inner: [], t: 0, pryT: 0,
        min: new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), max: new THREE.Vector3(p.x + p.hx, p.y + p.h, p.z + p.hz),
        lotMats: new Map(), lotBoxes: new Map(), shown: false,
      };
      if (kind === 'vending') this.settleSpill(h, layout.grid);
      this.placeLots(h);
      for (const l of h.state.lots) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + 1);
      this.all.push(h);
      if (!isC) { this.surfaces.push(h); continue; }
      const model = this.model(kind);
      const root = new THREE.Group();
      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.rot;
      root.name = `container-${kind}`;
      h.root = root;
      for (const leaf of model.leaves) {
        const hinge = new THREE.Group();
        hinge.position.copy(leaf.pivot);
        for (const part of leaf.parts) {
          const m = new THREE.Mesh(part.geo, part.mat);
          hinge.add(m);
          h.leafMeshes.push(m);
        }
        if (leaf.plate) {
          const plate = new THREE.Mesh(leaf.plate, model.plateMat);
          hinge.add(plate);
          h.inner.push(plate);
        }
        root.add(hinge);
        h.hinges.push({obj: hinge, axis: leaf.axis, angle: leaf.angle});
      }
      for (const e of [...model.interior, ...model.extras]) { const m = new THREE.Mesh(e.geo, e.mat); root.add(m); h.inner.push(m); }
      for (const o of h.inner) o.visible = false;
      this.group.add(root);
      this.list.push(h);
      let l = placements.get(kind);
      if (!l) placements.set(kind, (l = []));
      l.push(matrix.clone());
    }
    // Bodies: instanced per kind in ~12 m chunks (frustum culling), like builder props.
    for (const [kind, mats4] of placements) {
      const chunks = new Map<string, THREE.Matrix4[]>();
      const v = new THREE.Vector3();
      for (const m of mats4) {
        v.setFromMatrixPosition(m);
        const key = `${Math.floor(v.x / 12)},${Math.floor(v.z / 12)}`;
        let l = chunks.get(key);
        if (!l) chunks.set(key, (l = []));
        l.push(m);
      }
      for (const part of this.model(kind).body) {
        for (const list of chunks.values()) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          list.forEach((m, i) => im.setMatrixAt(i, m));
          im.name = `container-body-${kind}`;
          im.computeBoundingSphere();
          this.group.add(im);
          this.bodies.push(im);
        }
      }
    }
    this.display.allocate(counts);
    this.lastEye.set(layout.playerSpawn.x, 1.6, layout.playerSpawn.z);
    this.dirty = true;
    this.group.updateMatrixWorld(true);
  }

  /** Vending spill lots that would land inside a wall are pulled back against the machine. */
  private settleSpill(h: Holder, grid: Grid): void {
    const front = h.surfaces[0];
    const v = new THREE.Vector3();
    for (const l of h.state.lots) {
      v.set(l.x, 0, l.z).applyMatrix4(h.matrix);
      const [cx, cy] = grid.cellOf(v.x, v.z);
      if (grid.cells[grid.idx(cx, cy)] === FLOOR) continue;
      l.z = front ? front.z0 + 0.04 : l.z;
    }
  }

  private placeLots(h: Holder): void {
    h.lotMats.clear();
    h.lotBoxes.clear();
    for (const l of h.state.lots) {
      h.lotMats.set(l.id, new THREE.Matrix4().multiplyMatrices(h.matrix, lotLocalMatrix(l)));
      const b = placementBox(l.itemId, l);
      h.lotBoxes.set(l.id, new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(h.matrix).expandByScalar(LOT_MARGIN));
    }
  }

  /** Removes the current station's holders (cached split geometry is kept for reuse). */
  clear(): void {
    this.setHighlight(null);
    this.highlightLot = -1;
    for (const im of this.bodies) { this.group.remove(im); im.dispose(); }
    this.bodies.length = 0;
    for (const c of this.list) if (c.root) this.group.remove(c.root);
    this.list.length = 0;
    this.surfaces.length = 0;
    this.all.length = 0;
    this.display.clear();
  }

  dispose(): void {
    this.clear();
    for (const m of this.cache.values()) {
      for (const p of m.body) p.geo.dispose();
      for (const l of m.leaves) { for (const p of l.parts) p.geo.dispose(); l.plate?.dispose(); }
      for (const e of [...m.interior, ...m.extras]) e.geo.dispose();
      for (const o of m.owned) o.dispose();
    }
    this.cache.clear();
    this.display.dispose();
    for (const m of [this.rimMat, ...this.hiMats.values()]) m.dispose();
    this.hiMats.clear();
  }

  // --- interaction ------------------------------------------------------------------------
  private lotsVisible(h: Holder): boolean {
    if (h.group === 'container') return h.t > 0.001;
    return h.state.open;
  }

  private displayId(h: Holder, l: Lot): number {
    return h.serial * 1000 + (l.id % 1000);
  }

  /**
   * What the crosshair is on within reach: an aimed item (inside an open container, on a shelf,
   * kiosk or vending spill) or a holder body. Not behind a wall, and closer than `maxT` (pass the
   * distance of a targeted floor pickup so a closer pickup wins). Items win over their own holder.
   */
  target(eye: THREE.Vector3, dir: THREE.Vector3, grid: Grid, maxT = Infinity): ContainerTarget | null {
    this.lastEye.copy(eye);
    let lotBest: {h: Holder; lot: Lot; t: number} | null = null;
    let body: {h: Holder; t: number} | null = null;
    const bodies: {h: Holder; t: number}[] = [];
    const range = (LOT_REACH + 2) ** 2;
    for (const h of this.all) {
      const dx = h.prop.x - eye.x, dz = h.prop.z - eye.z;
      if (dx * dx + dz * dz > range) continue;
      const hit = rayAabb(eye, dir, h.min, h.max);
      if (hit && hit.t < Math.min(CONTAINER_REACH, maxT)) bodies.push({h, t: hit.t});
      if (!this.lotsVisible(h)) continue;
      for (const lot of h.state.lots) {
        const b = h.lotBoxes.get(lot.id);
        const r = b && rayAabb(eye, dir, b.min, b.max);
        if (r && r.t < Math.min(LOT_REACH, maxT) && (!lotBest || r.t < lotBest.t)) lotBest = {h, lot, t: r.t};
      }
    }
    for (const b of bodies) if (!body || b.t < body.t) body = b;
    let out: ContainerTarget | null = null;
    if (lotBest) {
      // Another holder in front (e.g. a crate before a shelf) blocks the item; its own holder does not.
      const blocker = bodies.filter(b => b.h !== lotBest!.h && b.t < lotBest!.t - 0.02).sort((a, b) => a.t - b.t)[0];
      out = blocker ? {container: blocker.h, t: blocker.t, lot: null} : {container: lotBest.h, t: lotBest.t, lot: lotBest.lot};
    } else if (body) out = {container: body.h, t: body.t, lot: null};
    // Empty tables/desks are just furniture.
    if (out && !out.lot && (out.container.kind === 'table' || out.container.kind === 'desk') && !out.container.state.lots.length) out = null;
    if (out) {
      const hl = Math.hypot(dir.x, dir.z);
      if (hl > 1e-6 && grid.raycast(eye.x, eye.z, dir.x, dir.z, out.t * hl + 0.01, true) < out.t * hl - 0.03) out = null;
    }
    this.setHighlight(out && !out.lot && out.container.group === 'container' && !out.container.broken ? out.container : null);
    const lotId = out?.lot ? this.displayId(out.container, out.lot) : -1;
    if (lotId !== this.highlightLot) { this.highlightLot = lotId; this.dirty = true; }
    return out;
  }

  /** [E] on a target: take the aimed item, or open / pry / take all / close the holder. */
  interact(target: ContainerTarget | Holder): void {
    const h = 'container' in target ? target.container : target;
    const lot = 'container' in target ? target.lot : null;
    const inv = this.inventory();
    if (lot && this.lotsVisible(h) && h.state.lots.includes(lot)) {
      this.afterTake(h, takeLot(h.state, lot.id, inv));
      return;
    }
    // Lane D: a smashed holder only gives up what is left on the floor (never closes / re-rolls).
    if (h.broken) { if (h.state.lots.length) this.afterTake(h, takeAll(h.state, inv)); return; }
    switch (nextHolderAction(h.state)) {
      case 'open': {
        const first = !h.state.searched;
        h.state.open = true;
        h.state.searched = true;
        const m = first ? openMessage(h.state) : null;
        this.emit({type: 'open', container: h, ...(m ? {message: m.text, warn: m.warn} : {})});
        break;
      }
      case 'pry':
        if (h.pryT <= 0) { h.pryT = PRY_TIME; this.emit({type: 'search', container: h}); }
        break;
      case 'take':
        this.afterTake(h, takeAll(h.state, inv));
        break;
      case 'close':
        h.state.open = false;
        this.emit({type: 'close', container: h});
        break;
      case 'none':
        break;
    }
  }

  private afterTake(h: Holder, result: TransferResult): void {
    const m = transferMessage(h.state, result);
    this.emit({type: 'take', container: h, result, message: m.text, warn: m.warn});
    this.dirty = true;
  }

  /** HUD prompt (HTML) for a target. */
  prompt(target: ContainerTarget | Holder): string {
    const h = 'container' in target ? target.container : target;
    const lot = 'container' in target ? target.lot : null;
    const inv = this.inventory();
    if (!lot && h.broken) return h.state.lots.length ? `<b>[E]</b> Take all from the smashed ${HOLDER_LABEL[h.kind]} (${h.state.lots.length})` : `Smashed ${HOLDER_LABEL[h.kind]} — nothing left`;
    const p = lot
      ? lotPrompt(lot, inv.hasRoomFor(lot.itemId))
      : holderPrompt(h.state, {roomForAny: h.state.lots.some(l => inv.hasRoomFor(l.itemId)), prying: h.pryT > 0});
    return p.key ? `<b>[E]</b> ${p.text}` : p.text;
  }

  update(dt: number, time: number): void {
    for (const h of this.surfaces) {
      if (h.pryT <= 0) continue;
      h.pryT -= dt;
      if (h.pryT > 0) continue;
      h.pryT = 0;
      h.state.open = true;
      h.state.searched = true;
      const m = openMessage(h.state);
      this.emit({type: 'open', container: h, message: m.text, warn: m.warn});
      this.dirty = true;
    }
    for (const c of this.list) {
      const goal = c.state.open ? 1 : 0;
      if (c.t === goal) continue;
      c.t = goal > c.t ? Math.min(1, c.t + dt / OPEN_TIME) : Math.max(0, c.t - dt / CLOSE_TIME);
      const k = ease(c.t);
      for (const hg of c.hinges) hg.obj.rotation[hg.axis] = hg.angle * k;
      const show = c.t > 0.001;
      for (const o of c.inner) o.visible = show;
      if (show !== c.shown) this.dirty = true;
    }
    this.refreshT -= dt;
    if (this.dirty || this.refreshT <= 0) this.refresh();
    if (this.highlighted) {
      const k = 0.06 + 0.035 * Math.sin(time * 6);
      for (const m of this.hiMats.values()) m.emissive.setRGB(k, k * 0.85, k * 0.5);
    }
    this.display.pulse(time);
  }

  /** Rewrites the visible item instances: nearby holders whose contents can be seen. */
  private refresh(): void {
    this.dirty = false;
    this.refreshT = REFRESH;
    const list: LotInstance[] = [];
    const r2 = LOT_VIEW_DIST * LOT_VIEW_DIST;
    for (const h of this.all) {
      h.shown = this.lotsVisible(h);
      if (!h.shown || !h.state.lots.length) continue;
      const dx = h.prop.x - this.lastEye.x, dz = h.prop.z - this.lastEye.z;
      if (dx * dx + dz * dz > r2) continue;
      for (const l of h.state.lots) list.push({id: this.displayId(h, l), itemId: l.itemId, matrix: h.lotMats.get(l.id)!});
    }
    this.display.show(list, this.highlightLot >= 0 ? this.highlightLot : null);
  }

  private emit(e: ContainerEvent): void {
    this.onEvent?.(e);
  }

  private setHighlight(c: Holder | null): void {
    if (c === this.highlighted) return;
    if (this.highlighted) for (const m of this.highlighted.leafMeshes) m.material = (m.userData.baseMat as THREE.Material) ?? m.material;
    this.highlighted = c;
    if (!c) return;
    for (const m of c.leafMeshes) {
      const base = (m.userData.baseMat as THREE.Material | undefined) ?? (m.material as THREE.Material);
      m.userData.baseMat = base;
      if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      let hi = this.hiMats.get(base);
      if (!hi) { hi = cloneWithShaderHooks(base as THREE.MeshStandardMaterial); this.hiMats.set(base, hi); } // Lane D: keeps damage / wound shader hooks
      m.material = hi;
    }
  }

  // --- Iteration 06 (Lane D): damage / breaking ------------------------------------------
  /** The loot holder standing on this prop placement, if any. */
  holderFor(prop: PropPlacement): Holder | null {
    return this.all.find(h => h.prop === prop) ?? null;
  }

  /** Meshes drawn for this holder alone (doors / lid / interior), for per-instance damage. */
  ownMeshes(prop: PropPlacement): THREE.Mesh[] {
    const h = this.holderFor(prop);
    const out: THREE.Mesh[] = [];
    h?.root?.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
    return out;
  }

  /**
   * A holder's prop broke under gunfire. 'splinter' (crate): the box is gone, its FINITE lots drop
   * to the floor where they were (same lot ids / counts, nothing re-rolled or destroyed) and stay
   * takeable; 'open' (vending front shot out): exactly like a finished pry (contents spill once).
   * Glass / screen breaks on coolers and display cases change nothing here (lots stay reachable).
   */
  breakHolder(h: Holder, kind: string): void {
    if (kind === 'open') {
      if (h.state.open) return;
      h.pryT = 0;
      h.state.open = true;
      h.state.searched = true;
      const m = openMessage(h.state);
      this.emit({type: 'open', container: h, message: m.text, warn: m.warn});
      this.dirty = true;
      return;
    }
    if (kind !== 'splinter' && kind !== 'collapse') return;
    h.broken = true;
    h.state.open = true;
    h.state.searched = true;
    if (h.root) h.root.visible = false;
    for (const l of h.state.lots) l.y = Math.min(l.y, 0.004);
    this.placeLots(h);
    h.t = 1;
    h.max.y = h.min.y + 0.35;
    if (this.highlighted === h) this.setHighlight(null);
    this.dirty = true;
  }

  // --- Iteration 07 (Lane K): shot loot lots become loose physical items ------------------
  /** Visible lots a shot ray crosses before maxT (their own oriented model box, 1 cm pad), nearest first. */
  shotLots(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, maxT: number): {holder: Holder; lotId: number; t: number}[] {
    const out: {holder: Holder; lotId: number; t: number}[] = [];
    const inv = new THREE.Matrix4(), lo = new THREE.Vector3(), ld = new THREE.Vector3();
    for (const h of this.all) {
      if (!h.state.lots.length || !this.lotsVisible(h)) continue;
      const rx = h.prop.x - o.x, rz = h.prop.z - o.z, along = rx * d.x + rz * d.z, reach = Math.max(h.prop.hx, h.prop.hz) + 1.5;
      if (along < -reach || along > maxT + reach || Math.hypot(rx - d.x * along, rz - d.z * along) > reach) continue;
      for (const l of h.state.lots) {
        const m = h.lotMats.get(l.id);
        if (!m) continue;
        const dm = itemDims(l.itemId);
        inv.copy(m).invert();
        lo.set(o.x, o.y, o.z).applyMatrix4(inv);
        ld.set(d.x, d.y, d.z).transformDirection(inv);
        const p = 0.01;
        const r = rayAabb(lo, ld, {x: -dm.w / 2 - p, y: -p, z: -dm.d / 2 - p}, {x: dm.w / 2 + p, y: dm.h + p, z: dm.d / 2 + p});
        if (r && r.t < maxT) out.push({holder: h, lotId: l.id, t: r.t});
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /**
   * Lift one visible lot OFF its holder (it is removed from the holder's finite contents, so it can
   * never be taken twice) and return it with its exact world transform; the caller turns it into a
   * loose pickup with the same item id and count. null if it is not there / not visible.
   */
  detachLot(h: Holder, lotId: number): {lot: Lot; matrix: THREE.Matrix4; holder: number} | null {
    if (!this.lotsVisible(h)) return null;
    const i = h.state.lots.findIndex(l => l.id === lotId);
    if (i < 0) return null;
    const [lot] = h.state.lots.splice(i, 1);
    const matrix = (h.lotMats.get(lot.id) ?? h.matrix).clone();
    h.lotMats.delete(lot.id);
    h.lotBoxes.delete(lot.id);
    if (this.highlightLot === this.displayId(h, lot)) this.highlightLot = -1;
    this.dirty = true;
    return {lot, matrix, holder: h.serial};
  }

  /** Visible lots whose (unpadded) box overlaps a world box — what a flying item knocks into. */
  lotsInBox(box: THREE.Box3): {holder: Holder; lotId: number}[] {
    const out: {holder: Holder; lotId: number}[] = [];
    const c = box.getCenter(new THREE.Vector3()), b = new THREE.Box3();
    for (const h of this.all) {
      if (!h.state.lots.length || Math.abs(h.prop.x - c.x) > h.prop.hx + 0.8 || Math.abs(h.prop.z - c.z) > h.prop.hz + 0.8 || !this.lotsVisible(h)) continue;
      for (const l of h.state.lots) {
        const lb = h.lotBoxes.get(l.id);
        if (lb && b.copy(lb).expandByScalar(-LOT_MARGIN).intersectsBox(box)) out.push({holder: h, lotId: l.id});
      }
    }
    return out;
  }

  /** Item / chunk collision of a loot holder (its shelves, physics/holderShapes.ts); null: not a holder (solid box). */
  physicsBoxes(prop: PropPlacement): THREE.Box3[] | null {
    const h = this.holderFor(prop);
    return h ? holderBoxes(prop, h.surfaces, {broken: !!h.broken}) : null;
  }

  // --- QA ---------------------------------------------------------------------------------
  /** Point on the holder to aim at (cabinet door centre / crate lid / shelf middle) and a spot to stand. */
  aimPoint(c: Holder): {aim: {x: number; y: number; z: number}; stand: {x: number; z: number}} {
    const def = holderDims(c.kind);
    const fx = Math.sin(c.prop.rot), fz = Math.cos(c.prop.rot);
    const front = c.kind === 'crate' ? 0 : def.d / 2 - 0.02;
    const y = c.kind === 'crate' ? c.prop.y + c.prop.h - 0.02 : c.prop.y + Math.min(c.prop.h * 0.5, 1.2);
    const away = def.d / 2 + (c.kind === 'vending' ? 1.0 : 0.65);
    return {aim: {x: c.prop.x + fx * front, y, z: c.prop.z + fz * front}, stand: {x: c.prop.x + fx * away, z: c.prop.z + fz * away}};
  }

  /** Centre of a lot's box (world) — QA aim helper. */
  lotPoint(h: Holder, l: Lot): {x: number; y: number; z: number} | null {
    const b = h.lotBoxes.get(l.id);
    if (!b) return null;
    const c = b.getCenter(new THREE.Vector3());
    return {x: c.x, y: c.y, z: c.z};
  }

  qaState(): {count: number; models: Record<string, string>; list: unknown[]} {
    const models: Record<string, string> = {};
    for (const [k, m] of this.cache) { models[k] = m.source; models[`${k}.interior`] = m.insert; }
    return {
      count: this.list.length,
      models,
      list: this.list.map(c => ({
        index: c.index, kind: c.kind, label: HOLDER_LABEL[c.kind], area: c.state.areaType, x: c.prop.x, z: c.prop.z, rot: c.prop.rot,
        open: c.state.open, searched: c.state.searched, searching: false, remaining: remainingCount(c.state), rolled: c.state.rolled,
        items: lotEntries(c.state.lots), lots: c.state.lots.length, anim: c.t, ...this.aimPoint(c),
      })),
    };
  }

  /** Loot overview for QA: per holder kind counts, visible item instances, model sources. */
  lootQa(): unknown {
    const byKind: Record<string, {count: number; nonEmptyAtStart: number; lotsAtStart: number; lotsLeft: number}> = {};
    for (const h of this.all) {
      const k = (byKind[h.kind] ??= {count: 0, nonEmptyAtStart: 0, lotsAtStart: 0, lotsLeft: 0});
      k.count++;
      if (h.state.rolled) k.nonEmptyAtStart++;
      k.lotsAtStart += h.state.rolled;
      k.lotsLeft += h.state.lots.length;
    }
    return {
      byKind, visibleItems: this.display.visible, drawBudget: this.display.drawBudget(), itemModels: itemModelSources(),
      shelf: shelfInfo(),
      holders: this.all.map(h => ({
        group: h.group, index: h.index, serial: h.serial, kind: h.kind, area: h.state.areaType, x: h.prop.x, z: h.prop.z,
        open: h.state.open, searched: h.state.searched, prying: h.pryT > 0, visible: this.lotsVisible(h),
        lots: h.state.lots.map(l => ({id: l.id, itemId: l.itemId, count: l.count, at: this.lotPoint(h, l)})), ...this.aimPoint(h),
      })),
    };
  }
}
