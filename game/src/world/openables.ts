// Iteration 08 (USER-UPDATE-01, Lane I): openable loot holders — trash cans, wheelie bins, newspaper boxes, staff lockers,
// filing cabinets, safes, chest freezers, glass-door coolers, wall first-aid / fire / defibrillator cabinets, crash carts, tool
// chests and desk pedestals get real lids / doors / drawers / sliding panes (world/openablesSpec.ts) on the existing holder model
// (world/containers.ts owns the holder state, targeting, taking and the finite lots).
//
// Geometry: the moving parts are DERIVED at runtime from the existing GLB derivative (triangles inside the part's region,
// cut exactly on the region faces with the shared splitter world/meshSplit.ts — the GLB files are never modified) or AUTHORED
// boxes where the model has no separable part. Revealed interiors (cavity liners, trash fill, newspaper stack, drawer trays,
// shelves) are authored and tinted from the model's own paint.
//
// Draw calls: a CLOSED holder costs nothing of its own — its body and its closed parts are instanced per kind per 12 m chunk
// (the body as `container-body-<kind>`, which the damage system indexes per instance; the closed parts as
// `openable-closed-<kind>`). A holder is TAKEN OVER (its closed-part instance hidden, its own pivot groups + interior meshes
// created) only while the player aims at it, while a part moves or stands open, or once damage / physics own it (pinned); a
// closed, idle, unpinned holder is handed back to instancing.
//
// Clearance: every part's full opening is fitted per placement against the walls of the holder's own storey, other props
// (incl. on-top decor and mounted fixtures) and doorway cells, sweeping sample points of the real moving geometry; a door
// against a wall / neighbour opens only as far as there is room (never through it). Parts have no collision of their own (the
// prop keeps its AABB): an open door never becomes an invisible blocker and never strands the player or AI.
// Task office-overhaul-20261030 (lane INTERACT): the toilet stall (a walk-in cubicle) is the one exception — world/stalls.ts gives
// its door leaf / partitions / toilet their own movement collision; a spec `bodyShape` draws a procedural prop shape as the body
// (optionally with a delivered model swapped in, setOpenableBodyModel) and `cavityHidden` keeps a cavity for item walls only.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshStandardNodeMaterial} from 'three/webgpu'; // Iteration 13 (MAT-A): node materials, same shadowSide fix
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {SOLID, type Grid} from '../gen/grid';
import type {Door} from '../gen/stationTypes';
import type {Level} from '../gen/levels';
import {rayAabb} from '../combat/hitscan';
import {PURPOSE_ACCENT, isPurposeMat, purposePropShape} from '../gen/purposeShapes';
import type {PurposePropKind} from '../gen/props';
import type {WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';
import {purposeMaterial} from './purposeTextures';
import {surface, type SurfaceName} from './canvasTextures';
import {averageColor, boxGeo, firstMaterial, fittedMeshes, partition, soupGeometry, toSoup, type Plane} from './meshSplit';
import {propShape} from '../gen/propShapes'; // Task office-overhaul-20261030 (lane INTERACT): toilet-stall body (bodyShape)
import {openableSpec, type AuthoredBox, type Box6, type MatRole, type OpenableKind, type OpenableSpec, type PartSpec} from './openablesSpec';

const OPEN_TIME = 0.5;
const CLOSE_TIME = 0.38;
/** Seconds a closed, idle holder keeps its own meshes before going back to instancing. */
const RELEASE_AFTER = 1.5;
const CHUNK = 12;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; role?: MatRole }

interface PartModel {
  /** Moving geometry, pivot-local. */
  moving: Part[];
  pivot: THREE.Vector3;
  /** Inner face of a door / lid (pivot-local), tray (pivot-local): shown while open. */
  plate: Part[];
  tray: Part[];
  /** Static interior (holder-local): cavity liner, fill, shelves — shown while open. */
  inner: Part[];
  /** Holder-local closed-pose bounds of the moving part (aiming, clearance). */
  bounds: THREE.Box3;
  /** Sample points of the moving geometry (pivot-local) for the clearance sweep. */
  sweep: THREE.Vector3[];
}

interface OpenModel {
  kind: OpenableKind;
  gltf: GLTF | null;
  body: Part[];
  parts: PartModel[];
  /** Every part's moving geometry in its closed pose, merged per material (holder-local): the closed instancing. */
  closed: Part[];
  geos: THREE.BufferGeometry[];
  owned: THREE.Material[];
  paint: THREE.Color;
  source: string;
  /** Task office-overhaul-20261030 (lane INTERACT): the delivered model a `bodyShape.swap` used (null: the shape's own parts). */
  swap: GLTF | null;
}

export interface OpenPartState {
  /** Animation 0 closed … 1 open. */
  t: number;
  /** Clearance-fitted full opening: signed hinge angle (rad) or slide travel (m). */
  amount: number;
  /** Fitted opening is below the spec minimum (cramped spot; QA). */
  cramped: boolean;
  pivot: THREE.Group | null;
  /** Visible moving meshes (highlight). */
  meshes: THREE.Mesh[];
  /** Objects shown only while the part is open (plates, trays, cavity, fill). */
  inner: THREE.Object3D[];
}

/** Per-holder openable runtime (Holder.open). */
export interface OpenRT {
  kind: OpenableKind;
  spec: OpenableSpec;
  model: OpenModel;
  parts: OpenPartState[];
  /** Model frame (prop placement + low-mount lift) -> world. */
  matrix: THREE.Matrix4;
  /** Own meshes while taken over (matrixAutoUpdate off: physics may drive it). */
  root: THREE.Group | null;
  slots: {mesh: THREE.InstancedMesh; index: number}[];
  accent: number | null;
  /** Damage / physics own the meshes: never handed back to instancing. */
  pinned: boolean;
  /** Knocked loose by a shot (trash cans): spilled, not targetable any more. */
  loose: boolean;
  /** The glass of a glazed door broke: its compartment is reachable without opening. */
  glassBroken: boolean;
  idle: number;
}

/** The holder fields openables need (world/containers.ts Holder). */
export interface OpenHolder {
  kind: string;
  prop: PropPlacement;
  serial: number;
  matrix: THREE.Matrix4;
  state: {parts?: boolean[]};
  open?: OpenRT;
}

// ---------------------------------------------------------------------------------------
// Materials

const ROLE: Record<Exclude<MatRole, 'body' | 'inner' | 'accent'>, {color: number; map: SurfaceName; rough: number; metal: number}> = {
  liner: {color: 0x1c1f1d, map: 'black', rough: 0.55, metal: 0},
  fill: {color: 0x3b362e, map: 'black', rough: 0.95, metal: 0},
  paper: {color: 0xbab4a2, map: 'paintedPanel', rough: 0.95, metal: 0},
  frost: {color: 0xd3dde2, map: 'plastic', rough: 0.55, metal: 0},
  stock: {color: 0x6f86a6, map: 'plastic', rough: 0.7, metal: 0},
  steelDark: {color: 0x3d4044, map: 'paintedSteel', rough: 0.7, metal: 0.35},
  steelBright: {color: 0x9ca2a8, map: 'brushedSteel', rough: 0.4, metal: 0.7},
  black: {color: 0x141414, map: 'black', rough: 0.8, metal: 0.1},
  white: {color: 0xe6e2d8, map: 'paintedPanel', rough: 0.85, metal: 0.05},
  shadow: {color: 0x040404, map: 'black', rough: 1, metal: 0},
  wood: {color: 0x7b5d43, map: 'woodVeneer', rough: 0.75, metal: 0},
  // Task office-overhaul-20261030 (lane INTERACT): toilet-stall door leaf — world/shapeMaterials.ts 'partition' tint, mesh UVs (it moves)
  partition: {color: 0xa3b3ae, map: 'paintedPanel', rough: 0.8, metal: 0.15},
};

/**
 * Task office-overhaul-20261030 (lane INTERACT): models a spec's `bodyShape.swap` may use (asset id -> GLTF, null = not delivered).
 * world/stalls.ts sets the company `toilet` model (assets/companyAssets.ts) before the section is built; a changed model rebuilds
 * the kind's cached geometry at the next ContainerManager.build.
 */
const bodySwaps = new Map<string, GLTF>();
export function setOpenableBodyModel(asset: string, gltf: GLTF | null): void {
  if (gltf) bodySwaps.set(asset, gltf); else bodySwaps.delete(asset);
}

/**
 * Iteration 12 (ATMOS, user feedback #4 "my flashlight does not light the inside" of an opened cupboard / fridge / locker):
 * a revealed interior liner is a closed box drawn BackSide (its inner faces). With `shadowSide` unset, three r186's shadow pass
 * draws the OPPOSITE side of a material (WebGLShadowMap: `shadowSide ?? {Front: Back, Back: Front}[side]`), i.e. the liner's
 * OUTWARD faces — including the face spanning the opening. That invisible lid sat in the flashlight's shadow map right where
 * the door had been, so with the door open every liner wall and every item inside still failed the shadow test and stayed
 * dark. The shadow pass now draws the same inner faces the colour pass draws: an opened compartment is lit from the real
 * flashlight direction (shelves / items / the door's own edge still cast onto it), while a CLOSED door — and the holder's
 * body, which casts from both sides — keep occluding it. Exported for world/containers.ts and tests.
 */
export function interiorShadowSide<M extends THREE.Material>(m: M): M {
  if (m.side === THREE.BackSide) m.shadowSide = THREE.BackSide;
  return m;
}

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const AX = {x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0)};

/** Holder-local transform of part `p` opened by `amount` (hinge angle / slide travel) — pivot · R · pivot⁻¹ or T(dir · d). */
export function partLocalMatrix(spec: PartSpec, pivot: THREE.Vector3, amount: number, out: THREE.Matrix4): THREE.Matrix4 {
  const mv = spec.move;
  if (mv.type === 'hinge') {
    tmpQ.setFromAxisAngle(AX[mv.axis], amount);
    out.makeRotationFromQuaternion(tmpQ);
    // p' = pivot + R (p - pivot)
    tmpV.copy(pivot).sub(tmpV.clone().copy(pivot).applyQuaternion(tmpQ));
    out.setPosition(tmpV);
    return out;
  }
  const [dx, dy, dz] = mv.dir;
  return out.makeTranslation(dx * amount, dy * amount, dz * amount);
}

/** Current (eased) opening of part i, including a resting ajar fraction. */
export function partAmount(rt: OpenRT, i: number): number {
  return rt.parts[i].amount * ease(rt.parts[i].t);
}

export class OpenableSet {
  readonly group = new THREE.Group();
  private models: Record<string, GLTF | undefined> = {};
  private mats: WorldMaterials | null = null;
  private readonly cache = new Map<OpenableKind, OpenModel>();
  private readonly roleMats = new Map<string, THREE.Material>();
  private readonly instanced: THREE.InstancedMesh[] = [];
  private pending: OpenHolder[] = [];
  /** Holders currently taken over (own meshes). */
  readonly active = new Set<OpenHolder>();
  /** QA counters. */
  readonly stats = {takeovers: 0, releases: 0, cramped: 0, fitted: 0};

  constructor() {
    this.group.name = 'openables';
  }

  // --- materials ------------------------------------------------------------------------
  private roleMat(role: MatRole, paint: THREE.Color, o: {back?: boolean; double?: boolean; accent?: number} = {}): THREE.Material {
    const key = `${role}|${role === 'body' || role === 'inner' ? paint.getHexString() : ''}|${o.accent ?? ''}|${o.back ? 'b' : o.double ? 'd' : 'f'}`;
    let m = this.roleMats.get(key);
    if (m) return m;
    const side = o.back ? THREE.BackSide : o.double ? THREE.DoubleSide : THREE.FrontSide;
    if (role === 'body' || role === 'inner') {
      const c = paint.clone().multiplyScalar(role === 'body' ? 0.62 : 0.5);
      m = new MeshStandardNodeMaterial({color: c, roughness: 0.88, metalness: 0.2, side, map: surface('paintedPanel').map});
    } else if (role === 'accent') {
      m = new MeshStandardNodeMaterial({color: o.accent ?? 0xffffff, roughness: 0.6, metalness: 0.3, side, map: surface('paintedSteel').map});
    } else {
      const r = ROLE[role];
      m = new MeshStandardNodeMaterial({color: r.color, roughness: r.rough, metalness: r.metal, side, map: surface(r.map).map});
    }
    interiorShadowSide(m); // Iteration 12 (ATMOS): back-side parts shadow from the faces they draw (#4)
    m.name = `openable-${role}`;
    this.roleMats.set(key, m);
    return m;
  }

  /** A cavity liner seen from inside: back faces of the box, the role's colour darkened like an unlit interior. */
  private cavityMat(spec: PartSpec, paint: THREE.Color): THREE.Material {
    const role = spec.cavityRole;
    const key = `cavity|${role ?? paint.getHexString()}`;
    let m = this.roleMats.get(key);
    if (m) return m;
    const base = role && role !== 'body' && role !== 'inner' && role !== 'accent' ? new THREE.Color(ROLE[role].color) : paint.clone();
    const k = role === 'frost' || role === 'white' ? 0.75 : 0.42;
    m = new MeshStandardNodeMaterial({color: base.multiplyScalar(k), roughness: 0.92, metalness: 0.15, side: THREE.BackSide, map: surface(role === 'frost' ? 'plastic' : 'paintedPanel').map});
    interiorShadowSide(m);
    m.name = 'openable-cavity';
    this.roleMats.set(key, m);
    return m;
  }

  // --- models ---------------------------------------------------------------------------
  setModels(models: Record<string, GLTF | undefined>, mats?: WorldMaterials): void { this.models = models; if (mats) this.mats = mats; }

  model(kind: OpenableKind): OpenModel {
    const spec = openableSpec(kind)!;
    const gltf = (spec.model && this.models[spec.model]) || null;
    const swap = (spec.bodyShape?.swap && bodySwaps.get(spec.bodyShape.swap.asset)) || null; // task office-overhaul-20261030 (INTERACT)
    let m = this.cache.get(kind);
    if (m && m.gltf === gltf && m.swap === swap) return m;
    if (m) this.disposeModel(m);
    m = this.buildModel(kind, spec, gltf, swap);
    this.cache.set(kind, m);
    return m;
  }

  private buildModel(kind: OpenableKind, spec: OpenableSpec, gltf: GLTF | null, swap: GLTF | null = null): OpenModel {
    const def = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[kind];
    const geos: THREE.BufferGeometry[] = [];
    const owned: THREE.Material[] = [];
    const paint = averageColor(firstMaterial(gltf ?? undefined)) ?? new THREE.Color(spec.body === 'model' ? 0x6a6e70 : 0x3d4044);
    const body: Part[] = [];
    const moving: Part[][] = spec.parts.map(() => []);
    const pivots = spec.parts.map(p => (p.move.type === 'hinge' ? new THREE.Vector3(...p.move.pivot) : new THREE.Vector3()));
    let source: string;
    if (spec.body === 'model' && gltf) {
      // DERIVED: one partition of the fitted derivative into body + every part's region (cut exactly on the region faces).
      const regions = spec.parts.map(p => (p.region ?? []).map(b => new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))));
      const planes: Plane[] = [];
      const all = new THREE.Box3();
      for (const rs of regions) for (const r of rs) {
        all.union(r);
        for (const axis of [0, 1, 2] as const) for (const v of [r.min.getComponent(axis), r.max.getComponent(axis)]) if (!planes.some(q => q.axis === axis && Math.abs(q.value - v) < 1e-6)) planes.push({axis, value: v});
      }
      const slabs = openingSlabs(spec, regions);
      // Iteration 12 (ATMOS, #4): liners that replace the model's own interior (openablesSpec replaceInterior)
      const replaced = spec.parts.filter(p => p.replaceInterior && p.cavity).map(p => new THREE.Box3(new THREE.Vector3(p.cavity![0], p.cavity![1], p.cavity![2]), new THREE.Vector3(p.cavity![3], p.cavity![4], p.cavity![5])).expandByScalar(-0.01));
      // cut exactly on those boxes too (large triangles straddling a liner wall would otherwise go by their centroid)
      for (const r of replaced) {
        all.union(r);
        for (const axis of [0, 1, 2] as const) for (const v of [r.min.getComponent(axis), r.max.getComponent(axis)]) if (!planes.some(q => q.axis === axis && Math.abs(q.value - v) < 1e-6)) planes.push({axis, value: v});
      }
      let remnants = 0;
      for (const {soup, mat} of fittedMeshes(gltf, def.w, def.h, def.d)) {
        const buckets = partition(soup, planes, all, 1 + spec.parts.length, (c, _nz, n) => {
          for (let i = 0; i < regions.length; i++) for (const r of regions[i]) if (r.containsPoint(c)) return i + 1;
          // Iteration 12 (ATMOS, #4): what the split leaves in a lined compartment's opening (see openingSlabs) is dropped.
          if (inOpeningSlab(c, n, slabs) || replaced.some(b => b.containsPoint(c))) { remnants++; return -1; }
          return 0;
        });
        if (buckets[0].length) body.push({geo: soupGeometry(soup, buckets[0]), mat});
        spec.parts.forEach((p, i) => {
          if (!buckets[i + 1].length) return;
          let pm = mat;
          if (p.doubleSide) { pm = (mat as THREE.MeshStandardMaterial).clone(); pm.side = THREE.DoubleSide; owned.push(pm); }
          moving[i].push({geo: soupGeometry(soup, buckets[i + 1], pivots[i]), mat: pm});
        });
      }
      source = `${spec.model}: runtime split into body + ${spec.parts.length} part(s) (approximate; GLB unchanged)${remnants ? `; ${remnants} face(s) left in lined openings / replaced interiors dropped` : ''}`;
    } else if (spec.body === 'model') {
      // Model missing (node tests / failed optional load): honest placeholder — the footprint box and boxed parts.
      body.push({geo: boxGeo(-def.w / 2, 0, -def.d / 2, def.w / 2, def.h * 0.8, def.d / 2), mat: this.roleMat('steelDark', paint)});
      spec.parts.forEach((p, i) => {
        for (const b of p.region ?? []) {
          const [x0, y0, z0, x1, y1, z1] = clampBox(b, def);
          moving[i].push({geo: boxGeo(x0, y0, z0, x1, y1, z1, pivots[i]), mat: this.roleMat('steelBright', paint)});
        }
      });
      source = `placeholder (no ${spec.model} loaded): boxes`;
    } else {
      source = spec.body === 'authored' ? 'authored body + parts (gen/purposeShapes.ts frame)' : 'authored parts over the world-built body';
    }
    // Authored body: the purpose shape minus what the openable replaces (shape / purpose materials, world-mapped like the
    // storefront builder's), then the authored boxes (merged per role).
    if (spec.bodyPurpose) {
      const parts = (purposePropShape(kind as PurposePropKind) ?? []).filter(q => !spec.bodyPurpose!.drop.some(b => q.p[0] > b[0] && q.p[0] < b[3] && q.p[1] > b[1] && q.p[1] < b[4] && q.p[2] > b[2] && q.p[2] < b[5]));
      const byKey = new Map<string, THREE.BufferGeometry[]>();
      for (const q of parts) {
        const g = new THREE.BoxGeometry(q.s[0], q.s[1], q.s[2]);
        if (q.rx) g.rotateX(q.rx);
        if (q.ry) g.rotateY(q.ry);
        g.translate(q.p[0], q.p[1], q.p[2]);
        let l = byKey.get(q.m);
        if (!l) byKey.set(q.m, (l = []));
        l.push(g.toNonIndexed());
        g.dispose();
      }
      for (const [key, list] of byKey) {
        const geo = list.length > 1 ? mergeGeometries(list, false) ?? list[0] : list[0];
        if (list.length > 1) for (const g of list) if (g !== geo) g.dispose();
        geo.computeBoundingSphere();
        const mat = isPurposeMat(key) ? purposeMaterial(key) : this.mats ? shapeMaterial(this.mats, key) : this.roleMat('steelDark', paint);
        body.push({geo, mat});
      }
    }
    // Task office-overhaul-20261030 (lane INTERACT): authored body from the PROCEDURAL prop shape (toilet stall), optionally with a
    // delivered model in place of some of its parts (the company toilet).
    if (spec.bodyShape) {
      const inBox = (q: {p: readonly number[]}, b: Box6) => q.p[0] > b[0] && q.p[0] < b[3] && q.p[1] > b[1] && q.p[1] < b[4] && q.p[2] > b[2] && q.p[2] < b[5];
      const sw = swap ? spec.bodyShape.swap : undefined;
      const parts = (propShape(kind as never) ?? []).filter(q => !spec.bodyShape!.drop.some(b => inBox(q, b)) && !(sw && sw.drop.some(b => inBox(q, b))));
      const byKey = new Map<string, THREE.BufferGeometry[]>();
      for (const q of parts) {
        const g = new THREE.BoxGeometry(q.s[0], q.s[1], q.s[2]);
        if (q.rx) g.rotateX(q.rx);
        g.translate(q.p[0], q.p[1], q.p[2]);
        let l = byKey.get(q.m);
        if (!l) byKey.set(q.m, (l = []));
        l.push(g.toNonIndexed());
        g.dispose();
      }
      for (const [key, list] of byKey) {
        const geo = list.length > 1 ? mergeGeometries(list, false) ?? list[0] : list[0];
        if (list.length > 1) for (const g of list) if (g !== geo) g.dispose();
        geo.computeBoundingSphere();
        body.push({geo, mat: this.mats ? shapeMaterial(this.mats, key as never) : this.roleMat('steelDark', paint)});
      }
      if (sw && swap) {
        for (const q of swapParts(swap, sw)) body.push(q);
        source = `authored body (gen/propShapes.ts shape) + ${sw.asset} model + parts`;
      } else source = 'authored body (gen/propShapes.ts shape) + parts';
    }
    if (spec.bodyBoxes?.length) for (const g of mergeByRole(spec.bodyBoxes)) body.push({geo: g.geo, mat: this.roleMat(g.role, paint), role: g.role});
    const parts: PartModel[] = spec.parts.map((p, i) => {
      const pivot = pivots[i];
      for (const g of mergeByRole(p.boxes ?? [], pivot)) moving[i].push({geo: g.geo, mat: this.roleMat(g.role, paint, {double: p.doubleSide}), role: g.role});
      const plate: Part[] = p.plate ? [{geo: boxGeo(p.plate[0], p.plate[1], p.plate[2], p.plate[3], p.plate[4], p.plate[5], pivot), mat: this.roleMat('body', paint)}] : [];
      if (p.plateDisc) {
        const [dx, dy, dz, r] = p.plateDisc;
        const g = new THREE.CylinderGeometry(r, r, 0.003, 40);
        g.translate(dx - pivot.x, dy - pivot.y, dz - pivot.z);
        plate.push({geo: g, mat: this.roleMat('body', paint)});
      }
      const tray = mergeByRole(p.tray ?? [], pivot).map(g => ({geo: g.geo, mat: this.roleMat(g.role, paint), role: g.role}));
      const inner: Part[] = [];
      if (p.cavity && !p.cavityHidden) inner.push({geo: boxGeo(...p.cavity), mat: this.cavityMat(p, paint)}); // task office-overhaul (INTERACT): cavityHidden
      if (p.cylinder) {
        const [r, y0, y1] = p.cylinder;
        const g = new THREE.CylinderGeometry(r, r * 0.94, y1 - y0, 20, 1, true);
        g.translate(0, (y0 + y1) / 2, 0);
        inner.push({geo: g, mat: this.cavityMat({...p, cavityRole: 'liner'}, paint)});
      }
      if (p.rim) inner.push({geo: rimGeo(p.rim), mat: this.roleMat('body', paint)});
      for (const g of mergeByRole(p.inner ?? [])) inner.push({geo: g.geo, mat: this.roleMat(g.role, paint), role: g.role});
      // Bounds + sweep samples of the moving part (closed pose): its SUPPORT points (the vertex farthest along each of 96
      // directions — the hull that can touch a wall or a neighbour first; a dome's bounding-box corners would swing far wider
      // than the dome itself, and every vertex would make fitting slow).
      const bounds = new THREE.Box3();
      const verts: THREE.Vector3[] = [];
      for (const q of moving[i]) {
        q.geo.computeBoundingBox();
        bounds.union(q.geo.boundingBox!.clone().translate(pivot));
        const pos = q.geo.attributes.position;
        for (let k = 0; k < pos.count; k++) verts.push(new THREE.Vector3().fromBufferAttribute(pos, k));
      }
      const sweep = supportPoints(verts, 96);
      if (bounds.isEmpty()) {
        const b = p.region?.[0] ?? p.plate ?? [-0.1, 0, -0.1, 0.1, 0.2, 0.1];
        bounds.set(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
      }
      return {moving: moving[i], pivot, plate, tray, inner, bounds, sweep};
    });
    // Closed instancing: every part's moving geometry back in its closed pose, merged per material.
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    parts.forEach(pm => {
      for (const q of pm.moving) {
        const g = q.geo.clone().translate(pm.pivot.x, pm.pivot.y, pm.pivot.z);
        let l = byMat.get(q.mat);
        if (!l) byMat.set(q.mat, (l = []));
        l.push(g);
      }
    });
    const closed: Part[] = [];
    for (const [mat, list] of byMat) {
      const merged = list.length > 1 ? mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)), false) ?? list[0] : list[0];
      if (merged !== list[0] || list.length > 1) for (const g of list) if (g !== merged) g.dispose();
      merged.computeBoundingSphere();
      closed.push({geo: merged, mat});
    }
    for (const q of [...body, ...closed, ...parts.flatMap(p => [...p.moving, ...p.plate, ...p.tray, ...p.inner])]) geos.push(q.geo);
    return {kind, gltf, body, parts, closed, geos, owned, paint, source, swap};
  }

  private disposeModel(m: OpenModel): void {
    for (const g of new Set(m.geos)) g.dispose();
    for (const o of m.owned) o.dispose();
  }

  // --- station lifecycle ------------------------------------------------------------------
  /**
   * Attach the openable runtime to a holder (prop placement + model frame): fits every part's opening to the free space around
   * this placement. Call finish() once all holders of the station are attached.
   */
  attach(h: OpenHolder, fit: FitContext | null): OpenRT | null {
    const kind = h.kind as OpenableKind;
    const spec = openableSpec(kind);
    if (!spec) return null;
    const model = this.model(kind);
    const palette = PURPOSE_ACCENT[kind as keyof typeof PURPOSE_ACCENT];
    const p = h.prop;
    const accent = palette?.length ? palette[Math.abs(Math.round(p.x * 7 + p.z * 13 + p.variant)) % palette.length] : null;
    const rt: OpenRT = {
      kind, spec, model, matrix: h.matrix.clone(), root: null, slots: [], accent, pinned: false, loose: false, glassBroken: false, idle: 0,
      parts: spec.parts.map((ps, i) => {
        const full = ps.move.type === 'hinge' ? ps.move.angle : ps.move.dist;
        const amount = fit ? fitPart(ps, model.parts[i], h.matrix, full, fit, p) : full;
        const cramped = Math.abs(amount) + 1e-6 < (ps.move.min ?? Math.abs(full) * 0.5);
        if (cramped) this.stats.cramped++;
        this.stats.fitted++;
        return {t: ps.ajar ?? 0, amount, cramped, pivot: null, meshes: [], inner: []};
      }),
    };
    h.open = rt;
    this.pending.push(h);
    return rt;
  }

  /** Builds the station's instanced bodies + closed parts (per kind, 12 m chunks). */
  finish(): void {
    const byKind = new Map<OpenableKind, OpenHolder[]>();
    for (const h of this.pending) {
      const rt = h.open!;
      let l = byKind.get(rt.kind);
      if (!l) byKind.set(rt.kind, (l = []));
      l.push(h);
    }
    this.pending = [];
    for (const [kind, list] of byKind) {
      const m = this.model(kind);
      const chunks = new Map<string, OpenHolder[]>();
      for (const h of list) {
        const key = `${Math.floor(h.prop.x / CHUNK)},${Math.floor(h.prop.z / CHUNK)}`;
        let l = chunks.get(key);
        if (!l) chunks.set(key, (l = []));
        l.push(h);
      }
      for (const hs of chunks.values()) {
        for (const part of m.body) this.instance(part, hs, `container-body-${kind}`, false);
        for (const part of m.closed) this.instance(part, hs, `openable-closed-${kind}`, true);
      }
      // Ajar parts never rest closed: those holders keep their own meshes.
      for (const h of list) if (h.open!.spec.parts.some(p => p.ajar)) { this.takeover(h); h.open!.pinned = true; }
    }
    this.group.updateMatrixWorld(true);
  }

  private instance(part: Part, hs: OpenHolder[], name: string, slot: boolean): void {
    const accentPart = part.role === 'accent';
    const mat = accentPart ? this.roleMat('accent', new THREE.Color(), {accent: 0xffffff}) : part.mat;
    const im = new THREE.InstancedMesh(part.geo, mat, hs.length);
    hs.forEach((h, i) => {
      im.setMatrixAt(i, h.open!.matrix);
      if (accentPart) im.setColorAt(i, new THREE.Color(h.open!.accent ?? 0x8a8f94));
      if (slot) h.open!.slots.push({mesh: im, index: i});
    });
    im.name = name;
    im.computeBoundingSphere();
    this.group.add(im);
    this.instanced.push(im);
  }

  clear(): void {
    for (const h of [...this.active]) this.dropRoot(h);
    this.active.clear();
    for (const im of this.instanced) { this.group.remove(im); im.dispose(); }
    this.instanced.length = 0;
    this.pending = [];
    for (const k of Object.keys(this.stats) as (keyof OpenableSet['stats'])[]) this.stats[k] = 0;
  }

  dispose(): void {
    this.clear();
    for (const m of this.cache.values()) this.disposeModel(m);
    this.cache.clear();
    for (const m of this.roleMats.values()) m.dispose();
    this.roleMats.clear();
  }

  // --- own meshes ---------------------------------------------------------------------------
  /** Gives the holder its own meshes (pivot groups + interiors) and hides its closed-part instance. */
  takeover(h: OpenHolder): void {
    const rt = h.open;
    if (!rt || rt.root) return;
    const root = new THREE.Group();
    root.name = `openable-${rt.kind}`;
    root.matrixAutoUpdate = false;
    root.matrix.copy(rt.matrix);
    const m = rt.model;
    rt.parts.forEach((ps, i) => {
      const pm = m.parts[i], spec = rt.spec.parts[i];
      const pivot = new THREE.Group();
      ps.meshes = [];
      ps.inner = [];
      for (const q of pm.moving) {
        const mat = q.role === 'accent' ? this.roleMat('accent', m.paint, {accent: rt.accent ?? 0x8a8f94, double: spec.doubleSide}) : q.mat;
        const mesh = new THREE.Mesh(q.geo, mat);
        pivot.add(mesh);
        ps.meshes.push(mesh);
      }
      for (const q of [...pm.plate, ...pm.tray]) { const mesh = new THREE.Mesh(q.geo, q.mat); pivot.add(mesh); ps.inner.push(mesh); }
      for (const q of pm.inner) { const mesh = new THREE.Mesh(q.geo, q.mat); root.add(mesh); ps.inner.push(mesh); }
      root.add(pivot);
      ps.pivot = pivot;
    });
    // flashlight shadows: own meshes cast / receive like the instanced closed parts they replace (marked once per station)
    const ref = rt.slots[0]?.mesh;
    if (ref) root.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = ref.castShadow; mm.receiveShadow = ref.receiveShadow; } });
    this.group.add(root);
    rt.root = root;
    for (const s of rt.slots) { s.mesh.setMatrixAt(s.index, ZERO); s.mesh.instanceMatrix.needsUpdate = true; }
    rt.idle = 0;
    this.active.add(h);
    this.stats.takeovers++;
    this.pose(h);
  }

  /** Back to instancing (closed, idle, not pinned). */
  release(h: OpenHolder): void {
    const rt = h.open;
    if (!rt || !rt.root || rt.pinned || rt.loose) return;
    this.dropRoot(h);
    for (const s of rt.slots) { s.mesh.setMatrixAt(s.index, rt.matrix); s.mesh.instanceMatrix.needsUpdate = true; }
    this.stats.releases++;
  }

  private dropRoot(h: OpenHolder): void {
    const rt = h.open;
    if (!rt?.root) return;
    this.group.remove(rt.root);
    rt.root = null;
    for (const ps of rt.parts) { ps.pivot = null; ps.meshes = []; ps.inner = []; }
    this.active.delete(h);
  }

  /** Applies the current part openings to the own meshes. */
  pose(h: OpenHolder): void {
    const rt = h.open;
    if (!rt?.root) return;
    rt.parts.forEach((ps, i) => {
      if (!ps.pivot) return;
      const spec = rt.spec.parts[i], pm = rt.model.parts[i];
      const a = partAmount(rt, i);
      ps.pivot.position.copy(pm.pivot);
      ps.pivot.quaternion.identity();
      if (spec.move.type === 'hinge') ps.pivot.quaternion.setFromAxisAngle(AX[spec.move.axis], a);
      else ps.pivot.position.add(tmpV.set(spec.move.dir[0] * a, spec.move.dir[1] * a, spec.move.dir[2] * a));
      const show = ps.t > 0.001;
      for (const o of ps.inner) o.visible = show;
    });
    rt.root.updateMatrixWorld(true);
  }

  /**
   * Per frame: animate every part toward its state (open 1 / closed 0 / ajar), take over moving holders, hand idle closed ones
   * back to instancing. Returns the holders whose part openings changed this frame (their lots / boxes need refreshing).
   */
  update<H extends OpenHolder>(dt: number, holders: readonly H[], keep: OpenHolder | null): H[] {
    const moved: H[] = [];
    for (const h of holders) {
      const rt = h.open;
      if (!rt) continue;
      let changed = false, resting = true;
      rt.parts.forEach((ps, i) => {
        const spec = rt.spec.parts[i];
        const goal = h.state.parts?.[i] ? 1 : spec.ajar ?? 0;
        if (ps.t !== goal) {
          ps.t = goal > ps.t ? Math.min(goal, ps.t + dt / OPEN_TIME) : Math.max(goal, ps.t - dt / CLOSE_TIME);
          changed = true;
        }
        if (ps.t > (spec.ajar ?? 0) + 1e-4 || goal > (spec.ajar ?? 0)) resting = false;
      });
      if (changed) { if (!rt.root) this.takeover(h); this.pose(h); moved.push(h); }
      if (!rt.root) continue;
      if (resting && h !== keep && !rt.pinned && !rt.loose) {
        rt.idle += dt;
        if (rt.idle > RELEASE_AFTER) this.release(h);
      } else rt.idle = 0;
    }
    return moved;
  }

  /** Ray vs every part's CURRENT box (holder frame -> world): nearest part hit before maxT. */
  pick(h: OpenHolder, eye: THREE.Vector3, dir: THREE.Vector3, maxT: number): {part: number; t: number} | null {
    const rt = h.open;
    if (!rt) return null;
    let best: {part: number; t: number} | null = null;
    const box = new THREE.Box3();
    rt.parts.forEach((_, i) => {
      this.partWorldBox(rt, i, box);
      const r = rayAabb(eye, dir, box.min, box.max);
      if (r && r.t < maxT && (!best || r.t < best.t)) best = {part: i, t: r.t};
    });
    return best;
  }

  /** World AABB of part i at its current opening (aim box, slightly padded). */
  partWorldBox(rt: OpenRT, i: number, out: THREE.Box3): THREE.Box3 {
    const pm = rt.model.parts[i];
    partLocalMatrix(rt.spec.parts[i], pm.pivot, partAmount(rt, i), tmpM);
    return out.copy(pm.bounds).applyMatrix4(tmpM2.multiplyMatrices(rt.matrix, tmpM)).expandByScalar(0.01);
  }

  /** Holder-local transform of everything a part carries (slide parts: drawer contents); identity for hinges. */
  carryMatrix(rt: OpenRT, i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const spec = rt.spec.parts[i];
    if (spec.move.type !== 'slide') return out.identity();
    return partLocalMatrix(spec, rt.model.parts[i].pivot, partAmount(rt, i), out);
  }

  /** Point to aim at (world): the part's front-centre at its current opening; and a spot to stand. */
  aimPoint(rt: OpenRT, i: number): {aim: THREE.Vector3; stand: THREE.Vector3} {
    const pm = rt.model.parts[i];
    const b = pm.bounds;
    const local = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z - 0.005);
    if (rt.spec.parts[i].move.type === 'hinge' && rt.spec.parts[i].move.axis === 'x' && b.max.y - b.min.y < 0.35) local.set((b.min.x + b.max.x) / 2, b.max.y - 0.01, (b.min.z + b.max.z) / 2 + (b.max.z - b.min.z) * 0.3);
    partLocalMatrix(rt.spec.parts[i], pm.pivot, partAmount(rt, i), tmpM);
    const aim = local.applyMatrix4(tmpM).applyMatrix4(rt.matrix);
    const def = (PROP_DEFS as unknown as Record<string, {d: number}>)[rt.kind];
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(rt.matrix);
    const centre = new THREE.Vector3().setFromMatrixPosition(rt.matrix);
    const stand = centre.addScaledVector(fwd, def.d / 2 + (rt.spec.parts[i].move.type === 'slide' ? 0.95 : 0.7));
    return {aim, stand};
  }

  /** Every mesh drawn for this holder alone (takes it over first): damage marks / physics carry them. */
  ownMeshes(h: OpenHolder): THREE.Mesh[] {
    const rt = h.open;
    if (!rt) return [];
    this.takeover(h);
    rt.pinned = true;
    const out: THREE.Mesh[] = [];
    rt.root?.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
    return out;
  }

  qaModels(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, m] of this.cache) out[k] = m.source;
    return out;
  }
}

// ---------------------------------------------------------------------------------------
// Clearance fitting

/** What a part's opening must not pass through: the holder's storey (walls, doorways) and nearby props. */
export interface FitContext {
  grid: Grid;
  /** Doorway rects on this storey (cells). */
  doors: readonly Door[];
  /** Other props near the holder (bucketed by the caller). */
  props: readonly PropPlacement[];
}

/** Station-wide helper: the fit context of a placement (its storey's grid / doors, props within reach). */
export class FitIndex {
  private readonly buckets = new Map<string, PropPlacement[]>();
  constructor(private readonly layout: {grid: Grid; levels?: readonly Level[]; doors: readonly Door[]; props: readonly PropPlacement[]}) {
    for (const p of layout.props) {
      const key = `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`;
      let l = this.buckets.get(key);
      if (!l) this.buckets.set(key, (l = []));
      l.push(p);
    }
  }
  context(p: PropPlacement): FitContext {
    const level = p.level ?? 0;
    const grid = this.layout.levels?.[level]?.grid ?? this.layout.grid;
    const doors = this.layout.doors.filter(d => (d.level ?? 0) === level);
    const props: PropPlacement[] = [];
    const bx = Math.floor(p.x / 4), bz = Math.floor(p.z / 4);
    for (let z = bz - 1; z <= bz + 1; z++) for (let x = bx - 1; x <= bx + 1; x++) for (const q of this.buckets.get(`${x},${z}`) ?? []) if (q !== p && (q.level ?? 0) === level && q.h > 0.02) props.push(q);
    return {grid, doors, props};
  }
}

/** True when a world point lies in a wall cell, a doorway cell (below its lintel) or inside another prop's box. */
export function blockedAt(x: number, y: number, z: number, ctx: FitContext, self: PropPlacement, floorY: number): boolean {
  const g = ctx.grid;
  const [cx, cy] = g.cellOf(x, z);
  if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID) return true;
  for (const d of ctx.doors) if (cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h && y < floorY + d.height) return true;
  for (const q of ctx.props) {
    if (q === self) continue;
    const m = 0.01;
    if (x > q.x - q.hx + m && x < q.x + q.hx - m && z > q.z - q.hz + m && z < q.z + q.hz - m && y > q.y + m && y < q.y + q.h - m) return true;
  }
  return false;
}

/**
 * The largest opening (same sign as `full`) whose swept sample points stay clear of walls, doorways and other props; stepping
 * down 5° (hinges) / 2 cm (slides). Never below 0. Exported for tests.
 */
export function fitPart(spec: PartSpec, pm: {pivot: THREE.Vector3; sweep: readonly THREE.Vector3[]}, holder: THREE.Matrix4, full: number, ctx: FitContext, self: PropPlacement): number {
  const step = spec.move.type === 'hinge' ? 5 * Math.PI / 180 : 0.02;
  const sign = Math.sign(full) || 1;
  const m = new THREE.Matrix4(), w = new THREE.Matrix4(), v = new THREE.Vector3();
  const floorY = self.y;
  // only props within the part's reach can be touched (cheap prefilter on the station-wide neighbourhood)
  const o = new THREE.Vector3().setFromMatrixPosition(holder);
  const reach = Math.max(0, ...pm.sweep.map(q => q.clone().add(pm.pivot).length())) + Math.abs(spec.move.type === 'slide' ? full : 0) + 0.05;
  const g = ctx.grid;
  ctx = {
    grid: g,
    props: ctx.props.filter(q => Math.abs(q.x - o.x) < reach + q.hx && Math.abs(q.z - o.z) < reach + q.hz && q.y < o.y + reach && q.y + q.h > o.y - reach),
    doors: ctx.doors.filter(d => {
      const [cx0, cy0] = g.cellOf(o.x - reach, o.z - reach), [cx1, cy1] = g.cellOf(o.x + reach, o.z + reach);
      return d.x + d.w > cx0 - 1 && d.x < cx1 + 1 && d.y + d.h > cy0 - 1 && d.y < cy1 + 1;
    }),
  };
  // Samples already inside something while CLOSED (a can standing 2 cm into a wall cell, a neighbour placed overlapping the
  // box) are the placement's own overlap, not something the opening moves into: they are not counted.
  partLocalMatrix(spec, pm.pivot, 0, m);
  w.multiplyMatrices(holder, m);
  const live = pm.sweep.filter(s => { v.copy(s).add(pm.pivot).applyMatrix4(w); return !blockedAt(v.x, v.y, v.z, ctx, self, floorY); });
  const clearAt = (a: number): boolean => {
    partLocalMatrix(spec, pm.pivot, a, m);
    w.multiplyMatrices(holder, m);
    for (const s of live) {
      v.copy(s).add(pm.pivot).applyMatrix4(w);
      if (blockedAt(v.x, v.y, v.z, ctx, self, floorY)) return false;
    }
    return true;
  };
  // the whole sweep from closed to an opening (quarter steps) must be clear; openings are tried full first, then bisected
  // over the 5° / 2 cm ladder below it (a clear opening is clear at every smaller one in practice)
  const sweepClear = (amt: number) => [0.25, 0.5, 0.75, 1].every(f => clearAt(amt * f));
  if (sweepClear(full)) return full;
  const n = Math.floor(Math.abs(full) / step);
  const at = (k: number) => sign * Math.max(0, Math.abs(full) - k * step); // k = 0 full … n smallest
  let lo = 1, hi = n, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Math.abs(at(mid)) > 1e-6 && sweepClear(at(mid))) { best = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return best < 0 ? 0 : at(best);
}

// ---------------------------------------------------------------------------------------
// Geometry helpers

const SUPPORT_DIRS = new Map<number, THREE.Vector3[]>();
/** The vertices farthest along n evenly spread directions (Fibonacci sphere), de-duplicated. */
export function supportPoints(verts: readonly THREE.Vector3[], n: number): THREE.Vector3[] {
  let dirs = SUPPORT_DIRS.get(n);
  if (!dirs) {
    dirs = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
      dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    SUPPORT_DIRS.set(n, dirs);
  }
  const out = new Set<THREE.Vector3>();
  for (const d of dirs) {
    let best: THREE.Vector3 | null = null, bd = -Infinity;
    for (const v of verts) { const k = v.dot(d); if (k > bd) { bd = k; best = v; } }
    if (best) out.add(best);
  }
  return [...out].map(v => v.clone());
}

/**
 * Iteration 12 (ATMOS, #4): the opening of a LINED compartment (an authored cavity / cylinder liner replaces the model's own
 * interior) — the slab between the liner's opening face and the inner side of the part's region, over the liner's cross-section.
 * A model-derived body keeps whatever lay in that slab just inside the region cut: the inner skin of a split-off door, window
 * backing or lid underside. Facing INTO the holder (n . opening < -0.85), those faces are never front-facing to a viewer
 * outside it — invisible in the colour pass, open or closed — but the structure shadow marking (shadowSide double) let them
 * cast across the opening, so e.g. an opened newspaper box stayed in the flashlight's shadow. Only those are dropped (the
 * legacy cupboard split drops its stray interior surfaces the same way, world/containers.ts cabinetModel). Outward-facing
 * remnants are visible surfaces (a drawer front's recessed panel just behind the cut): they stay, and are lit like any surface.
 */
export interface OpeningSlab { axis: 0 | 1 | 2; sign: number; lo: number; hi: number; min: THREE.Vector3; max: THREE.Vector3; round: number }
export function openingSlabs(spec: Pick<OpenableSpec, 'parts'>, regions: readonly (readonly THREE.Box3[])[]): OpeningSlab[] {
  const out: OpeningSlab[] = [];
  spec.parts.forEach((p, i) => {
    const liner = p.cavity ?? (p.cylinder ? [-p.cylinder[0], p.cylinder[1], -p.cylinder[0], p.cylinder[0], p.cylinder[2], p.cylinder[0]] as const : null);
    if (!liner || !regions[i]?.length) return;
    const cav = new THREE.Box3(new THREE.Vector3(liner[0], liner[1], liner[2]), new THREE.Vector3(liner[3], liner[4], liner[5]));
    const reg = new THREE.Box3();
    for (const r of regions[i]) reg.union(r);
    const d = reg.getCenter(new THREE.Vector3()).sub(cav.getCenter(new THREE.Vector3()));
    const ad = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
    const axis = (ad[0] > ad[1] && ad[0] > ad[2] ? 0 : ad[1] > ad[2] ? 1 : 2) as 0 | 1 | 2;
    const s = Math.sign(d.getComponent(axis)) || 1;
    const open = s > 0 ? cav.max.getComponent(axis) : cav.min.getComponent(axis);
    const near = s > 0 ? reg.min.getComponent(axis) : reg.max.getComponent(axis);
    const inset = cav.clone().expandByScalar(-0.003);
    out.push({axis, sign: s, lo: Math.min(open, near) - 0.02, hi: Math.max(open, near) + 0.005, min: inset.min, max: inset.max, round: p.cavity ? 0 : p.cylinder![0] - 0.003});
  });
  return out;
}
/** A body face (centroid c, unit normal n) left in a lined opening and facing into the holder (see openingSlabs). */
export function inOpeningSlab(c: THREE.Vector3, n: THREE.Vector3, slabs: readonly OpeningSlab[]): boolean {
  for (const sl of slabs) {
    const v = c.getComponent(sl.axis);
    if (v < sl.lo || v > sl.hi || n.getComponent(sl.axis) * sl.sign >= -0.85) continue;
    const a = (sl.axis + 1) % 3, b = (sl.axis + 2) % 3;
    const ca = c.getComponent(a), cb = c.getComponent(b);
    if (sl.round > 0 ? ca * ca + cb * cb < sl.round * sl.round : ca > sl.min.getComponent(a) && ca < sl.max.getComponent(a) && cb > sl.min.getComponent(b) && cb < sl.max.getComponent(b)) return true;
  }
  return false;
}

function clampBox(b: Box6, def: {w: number; d: number; h: number}): Box6 {
  return [Math.max(b[0], -def.w / 2), Math.max(b[1], 0), Math.max(b[2], -def.d / 2), Math.min(b[3], def.w / 2), Math.min(b[4], def.h), Math.min(b[5], def.d / 2)];
}

/**
 * Task office-overhaul-20261030 (lane INTERACT): a delivered model as holder-local body parts — grounded and centred, turned by `yaw`
 * and placed at `at`; uniformly rescaled to `size` only when it is grossly mis-scaled (the company models are at real size).
 */
export function swapParts(gltf: GLTF, sw: {at: readonly [number, number, number]; size: readonly [number, number, number]; yaw: number}): {geo: THREE.BufferGeometry; mat: THREE.Material}[] {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return [];
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = Math.min(sw.size[0] / (size.x || 1), sw.size[1] / (size.y || 1), sw.size[2] / (size.z || 1));
  const s = k < 0.5 || k > 2 ? k : 1;
  // back edge (after the turn) on `at`: the model's +Z extent ends up at at.z after a half turn
  const turned = Math.abs(Math.cos(sw.yaw)) > 0.5 ? size.z : size.x;
  const fit = new THREE.Matrix4().makeTranslation(sw.at[0], sw.at[1], sw.at[2] + turned * s / 2)
    .multiply(new THREE.Matrix4().makeRotationY(sw.yaw)).multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const out: Part[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const soup = toSoup(mesh.geometry, new THREE.Matrix4().multiplyMatrices(fit, mesh.matrixWorld));
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    out.push({geo: soupGeometry(soup, Array.from(soup.data)), mat});
  });
  return out;
}

/** Authored boxes merged per material role (geometry translated by -origin). */
function mergeByRole(boxes: readonly AuthoredBox[], origin?: THREE.Vector3): {role: MatRole; geo: THREE.BufferGeometry}[] {
  const by = new Map<MatRole, THREE.BufferGeometry[]>();
  for (const b of boxes) {
    let l = by.get(b.m);
    if (!l) by.set(b.m, (l = []));
    l.push(boxGeo(b.b[0], b.b[1], b.b[2], b.b[3], b.b[4], b.b[5], origin).toNonIndexed());
  }
  const out: {role: MatRole; geo: THREE.BufferGeometry}[] = [];
  for (const [role, list] of by) {
    const geo = list.length > 1 ? mergeGeometries(list, false) ?? list[0] : list[0];
    if (list.length > 1) for (const g of list) if (g !== geo) g.dispose();
    geo.computeBoundingSphere();
    out.push({role, geo});
  }
  return out;
}

/** Flat rim at an opening: [ro, ri, y] ring (round can) or [ox, oz0, oz1, ix, iz0, iz1, y] rectangle frame. */
function rimGeo(r: readonly number[]): THREE.BufferGeometry {
  if (r.length === 3) {
    const g = new THREE.RingGeometry(r[1], r[0], 24);
    g.rotateX(-Math.PI / 2);
    g.translate(0, r[2], 0);
    return g;
  }
  const [ox, oz0, oz1, ix, iz0, iz1, y] = r;
  const s = new THREE.Shape([new THREE.Vector2(-ox, -oz1), new THREE.Vector2(ox, -oz1), new THREE.Vector2(ox, -oz0), new THREE.Vector2(-ox, -oz0)]);
  s.holes.push(new THREE.Path([new THREE.Vector2(-ix, -iz1), new THREE.Vector2(-ix, -iz0), new THREE.Vector2(ix, -iz0), new THREE.Vector2(ix, -iz1)]));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/**
 * Rate limit for door / lid / drawer sounds (Sound Lab bank cues reused): one cue per holder per `perHolder` seconds and at most
 * `burst` cues per rolling second station-wide — spamming [E] or a drawer bank never stacks clips.
 */
export class SoundGate {
  private readonly last = new Map<number, number>();
  private recent: number[] = [];
  constructor(private readonly perHolder = 0.22, private readonly burst = 6) {}
  allow(key: number, now: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < this.perHolder) return false;
    this.recent = this.recent.filter(x => now - x < 1);
    if (this.recent.length >= this.burst) return false;
    this.last.set(key, now);
    this.recent.push(now);
    return true;
  }
}
