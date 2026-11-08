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
//
// Iteration 08 (Lane I): OPENABLE holders (world/openables.ts, specs world/openablesSpec.ts) — trash cans, wheelie bins,
// newspaper boxes, staff lockers, filing cabinets, safes, chest freezers, glass-door coolers, wall first-aid / fire /
// defibrillator cabinets, crash-cart / tool-chest / desk drawers — open per COMPARTMENT (Holder.open, HolderState.parts): [E] on
// a lid / door / drawer opens it, then takes what lies inside it, then closes it. Contents are the same finite lots (open /
// close never re-rolls); drawers carry their lots; glass doors show theirs while closed. Closed openables are instanced
// (no per-holder draw calls); own meshes exist only while aimed at / moving / open / damaged / knocked loose.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as propsModule from '../gen/props';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {cutSurfaces} from '../gen/props07';
import {FLOOR, Grid} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {StationLayout} from '../gen/station';
import {rayAabb} from '../combat/hitscan';
import type {Inventory} from '../items/inventory';
import {itemDims} from '../items/items';
import {
  HOLDER_LABEL, createHolderState, holderPrompt, isContainerKind, isLootHolderKind, isSalvageLotId, lotEntries, lotPrompt,
  nextHolderAction, openMessage, partAction, partOpenMessage, partPrompt, remainingCount, takeAll, takeLot, takeLots, transferMessage,
  type HolderKind, type HolderState, type Lot, type PartInfo, type SurfaceKind, type TransferResult,
} from '../items/loot';
import {BASELINE_PROFILE, type LootProfile} from '../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {
  CABINET_SPECS, DEFAULT_SHELF, cabinetInsert, cabinetInterior, holderSurfaces, lotBoxesOverlap, placementBox,
  type Dims, type ShelfInfo, type Surface, type SurfaceOptions,
} from '../items/lootLayout';
import {MeshStandardNodeMaterial} from 'three/webgpu'; // Iteration 13 (MAT-A)
import {cloneSurfaceMaterial, type WorldMaterials} from './materials';
import {highlightPulse} from './highlight'; // task train-shell-followup-20261101-221246 (lane TRAIN): the shared highlight pulse
import {surface} from './canvasTextures';
import {LotDisplay, type LotInstance} from './lootDisplay';
import {itemModelSources} from './pickups';
import {holderBoxes} from '../physics/holderShapes';
import {averageColor, boxGeo, firstMaterial, fittedMeshes, partition, soupGeometry, type Plane, type Soup} from './meshSplit';
import {FitIndex, OpenableSet, interiorShadowSide, type OpenRT} from './openables';
import {openableActive, openableSpec} from './openablesSpec';
import {planCohorts, trianglesOf} from './staticCohorts'; // task static-batching-warmup-20261105

/**
 * Lid split for the generated crate model (`models.crate`, assets/models/crate-t25.glb): triangles
 * whose centroid is above this fraction of the fitted crate height become the lid. Meshy T2.5
 * (2026-10-29): the body's closed top cap sits at 0.356 m and the lid skirt starts at 0.362 m, so
 * the split at 0.350 m of 0.432 m lifts the cap with the lid (its underside) and leaves an open
 * box for the interior liner. (Iteration 02: 0.817, the seam groove at 0.353 m.) The placeholder
 * crate ignores it and uses a 7 cm lid.
 */
export const CRATE_LID_SPLIT_Y = 0.81;

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

// Iteration 04 (Lane C): interiors/door backs/shelving get the shared worn painted-sheet texture (mesh UVs; doors move).
// Iteration 13 (MAT-A): node materials; side / shadowSide semantics unchanged (WebGPURenderer: shadowSide ?? flip(side)).
const std = (color: THREE.Color | number, roughness: number, metalness: number, side: THREE.Side = THREE.FrontSide) =>
  new MeshStandardNodeMaterial({color, roughness, metalness, side, map: surface('paintedPanel').map});

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

/** The iteration-02 door / lid containers (the iteration-08 openables are built by world/openables.ts). */
type LegacyKind = 'cabinetTall' | 'cabinetLow' | 'crate';

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
  /**
   * (task studio-skywalk-variety-20261107-231448-01, lane MERCH) The same surfaces UNCUT: the real shelves under the on-top / shelf decor
   * too — item / chunk / loose-prop collision (physicsBoxes), so a piece of stock knocked loose stands on its shelf, never in a cut gap.
   */
  support?: Surface[];
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
  /** Iteration 08 (Lane I): openable compartments (lids / doors / drawers / panes), world/openables.ts. */
  open?: OpenRT;
}
/** Back-compat name (iteration 02). */
export type Container = Holder;

export interface ContainerEvent {
  /**
   * open: doors/lid start opening or a vending machine gives way. close. search: prying started. take.
   * spill (iteration 08): a trash can knocked loose by a shot — `spilled` are its finite lots (lifted off, world matrices) for
   * the caller to turn into loose pickups (same item id / count; nothing is created or destroyed).
   */
  type: 'open' | 'close' | 'search' | 'take' | 'spill';
  container: Holder;
  result?: TransferResult;
  message?: string;
  warn?: boolean;
  /** Iteration 08 (Lane I): the compartment acted on, its door-sound key (an existing holder key: audio/sfx.ts) and rummage cue. */
  part?: number;
  sound?: string;
  rummage?: boolean;
  spilled?: {lot: Lot; matrix: THREE.Matrix4}[];
}

/** What [E] would act on: an aimed item (`lot`), the holder body, or (iteration 08) one compartment `part` of an openable. */
export interface ContainerTarget { container: Holder; t: number; lot: Lot | null; part?: number | null }

// ---------------------------------------------------------------------------------------
// Geometry helpers (iteration 08, Lane I: the shared splitting helpers live in world/meshSplit.ts)

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

/** Task mall-round2-20261031 (lane PERF): the storey (level id) whose floor holds height y (the highest base at or below it). */
function storeyOf(layout: StationLayout, y: number): number {
  let id = 0, best = -Infinity;
  for (const l of layout.levels ?? []) if (l.baseY <= y + 0.3 && l.baseY > best) { best = l.baseY; id = l.id; }
  return id;
}

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
  /** Iteration 08 (Lane I): openable holders (also in `all`; the new container kinds are not in `list`). */
  readonly openables = new OpenableSet();
  readonly openList: Holder[] = [];
  private highlightPart = -1;
  /** Feedback hook (toasts/sfx live in game.ts). */
  onEvent: ((e: ContainerEvent) => void) | null = null;
  private readonly cache = new Map<LegacyKind, ContainerModel>();
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly rimMat = new MeshStandardNodeMaterial({color: 0x6b5640, roughness: 0.95, map: surface('woodVeneer').map});
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
    this.group.add(this.openables.group);
  }

  // --- models ---------------------------------------------------------------------------
  private model(kind: LegacyKind): ContainerModel {
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
    // Iteration 12 (ATMOS, #4): the back-side interior box shadows from its inner faces, not its opening face (openables.ts).
    const interiorMat = interiorShadowSide(std(paint.clone().multiplyScalar(0.42), 0.92, 0.2, THREE.BackSide));
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
        // Iteration 12 (ATMOS, #4): only a -Z face AT the interior's back plane counts as that outer back. The low cupboard's
        // model has a false back ~4 cm in front of it whose visible front face was dropped here but whose rear (-Z) face fell in
        // the old 5 cm window: invisible from the front, it still cast in the flashlight's double-sided shadow pass and kept the
        // whole opened cupboard dark. (The real back, behind zBack - 0.005, is never dropped.)
        if (inRect && c.z > zBack - 0.005 && !(nz < -0.6 && c.z < zBack + 0.006)) return -1;
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
    const interiorMat = interiorShadowSide(std(wood.clone().multiplyScalar(0.38), 0.95, 0, THREE.BackSide)); // Iteration 12 (ATMOS, #4)
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
  /**
   * Registers every loot holder of the layout and rolls its lots ONCE. Task loot-tables-20261030 (lane LOOT): `loot` = the section's
   * logical-level loot profile (game.ts: lootProfile(key.level)); default: the level-agnostic baseline (today's tables).
   */
  build(layout: StationLayout, extraModels: Record<string, GLTF | undefined> = {}, loot: LootProfile = BASELINE_PROFILE): void {
    this.clear();
    const opts = surfaceOptions();
    const placements = new Map<LegacyKind, {matrix: THREE.Matrix4; level: number}[]>();
    const counts = new Map<string, number>();
    let ci = 0, si = 0;
    // Iteration 08 (Lane I): openables split their (lazy p7) models; new container kinds index per kind (legacy indices keep).
    const allModels = {...this.models, ...extraModels};
    this.openables.setModels(allModels, this.mats);
    const fit = new FitIndex(layout);
    const openIdx = new Map<string, number>();
    for (const p of layout.props) {
      const kind = p.kind as string;
      if (!isLootHolderKind(kind)) continue;
      const isC = isContainerKind(kind);
      const def = holderDims(kind);
      // Iteration 07 (Lane P2): spans taken by on-top decor (register, lamp ...) are not loot surface.
      const support = holderSurfaces(kind, def, {...opts, crateSplitY: this.crateSplitY()});
      const surfaces = cutSurfaces(support, p.cut);
      // Iteration 05 (Lane R): the holder's purpose (prop override, else its room/store purpose)
      // keys the loot table (gen/purposes.ts); plain halls keep their room type.
      const area = layout.areas[p.area];
      const areaType = p.purpose ?? area?.purpose ?? area?.type ?? 'default';
      const openable = openableActive(kind, allModels);
      let index: number;
      if (isC && openable) { index = openIdx.get(kind) ?? 0; openIdx.set(kind, index + 1); } else index = isC ? ci++ : si++;
      // openables: the model frame includes a low wall mount's render lift (fire cabinets hang `lift` m above their floor box)
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + (openable ? p.lift ?? 0 : 0), p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
      const h: Holder = {
        group: isC ? 'container' : 'surface', index, serial: this.all.length, kind, prop: p,
        state: createHolderState(layout.seed, index, kind, areaType, surfaces, undefined, loot), surfaces, support, matrix,
        root: null, hinges: [], leafMeshes: [], inner: [], t: 0, pryT: 0,
        min: new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), max: new THREE.Vector3(p.x + p.hx, p.y + p.h, p.z + p.hz),
        lotMats: new Map(), lotBoxes: new Map(), shown: false,
      };
      if (kind === 'vending') this.settleSpill(h, layout.levels?.[p.level ?? 0]?.grid ?? layout.grid); // iteration 08: the holder's own storey
      if (openable) { this.openables.attach(h, fit.context(p, !!openableSpec(kind)?.seatAside)); this.openList.push(h); } // seatAside: lane OPEN (office-interactions-layout)
      this.placeLots(h);
      for (const l of h.state.lots) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + 1);
      this.all.push(h);
      if (!isC) { this.surfaces.push(h); continue; }
      if (h.open) continue; // iteration 08: drawn by world/openables.ts (instanced body + closed parts)
      const model = this.model(kind as LegacyKind);
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
      let l = placements.get(kind as LegacyKind);
      if (!l) placements.set(kind as LegacyKind, (l = []));
      l.push({matrix: matrix.clone(), level: p.level ?? 0});
    }
    // Task mall-round2-20261031 (lane PERF): in the mall the chunks are per storey too (a batch spanning two storeys was never culled)
    // Task studio-reactor-submit-roof-fog-20261102 (lane CPU): + the Reactor (six tiers stacked round / behind the pit; its culler has
    // the same slab / storey occlusion, so the per-storey loot display batches are decided like the mall's)
    // (task studio-skywalk-variety-20261107-231448-01, lane PERF: + the Skyways — its culler has the same occlusion now)
    const byStorey = !!(layout as {mall?: unknown}).mall || !!(layout as {reactor?: unknown}).reactor || !!(layout as {skyways?: unknown}).skyways;
    this.openables.finish(byStorey);
    // Bodies: instanced per kind in ~12 m chunks (frustum culling), like builder props. Task static-batching-warmup-20261105
    // (world/staticCohorts.ts): per level on every level (the holder's own level; was: the mall / Reactor by storey band); coarse
    // cohorts for a cheap kind where the culler has no slab occlusion (!byStorey).
    for (const [kind, list0] of placements) {
      const body = this.model(kind).body;
      let tris = 0;
      for (const part of body) tris += trianglesOf(part.geo);
      const chunks = planCohorts(list0, e => ({x: e.matrix.elements[12], z: e.matrix.elements[14], level: e.level}), 12, tris, !byStorey);
      for (const part of body) {
        for (const {level, list} of chunks.values()) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          list.forEach((e, i) => im.setMatrixAt(i, e.matrix));
          im.name = `container-body-${kind}`;
          im.userData.level = level;
          im.computeBoundingSphere();
          this.group.add(im);
          this.bodies.push(im);
        }
      }
    }
    this.built = layout;
    this.allocateDisplay(layout, counts);
    this.lastEye.set(layout.playerSpawn.x, 1.6, layout.playerSpawn.z);
    this.dirty = true;
    this.group.updateMatrixWorld(true);
  }

  /** The layout of the last build (addLots re-allocates the display for it). */
  private built: StationLayout | null = null;

  /** (Re)allocates the loot display for `counts` (lots per item id) of this station's holders. */
  private allocateDisplay(layout: StationLayout, counts: Map<string, number>): void {
    // Task mall-round2-20261031 (lane PERF, M05): in the mall the loot display batches per (item, storey) + one all-storey batch,
    // frustum-bounded and registered with the level culler (world/lootDisplay.ts); elsewhere one unbounded batch per item as before
    // (task studio-skywalk-variety-20261107-231448-01, lane PERF: + the Skyways)
    const byStorey = !!(layout as {mall?: unknown}).mall || !!(layout as {reactor?: unknown}).reactor || !!(layout as {skyways?: unknown}).skyways;
    if (byStorey) {
      const perStorey = new Map<string, Set<number>>();
      for (const h of this.all) for (const l of h.state.lots) {
        let set = perStorey.get(l.itemId);
        if (!set) perStorey.set(l.itemId, (set = new Set()));
        set.add(storeyOf(layout, h.prop.y));
      }
      this.display.storeyOf = y => storeyOf(layout, y);
      this.display.allocate(counts, {perStorey, all: (layout.levels ?? []).map(l => l.id)});
    } else {
      this.display.storeyOf = null;
      this.display.allocate(counts);
    }
  }

  /**
   * Task studio-beta-fuel-feedback-20261106-064128-01: extra lots placed in holders' FREE room right after build (before the shelf
   * filler and the section memory: world/fuelStations.ts fuel cans, gen/fuelHolders.ts). Each lot id must be new for its holder (the
   * rolled lots, their ids and streams are untouched). The holders' lot transforms are re-placed and the display re-allocated (before
   * the warm-up). Returns the lots added.
   */
  addLots(adds: readonly {holder: Holder; lots: readonly Lot[]}[]): number {
    let n = 0;
    for (const {holder: h, lots} of adds) {
      const ids = new Set(h.state.lots.map(l => l.id));
      let k = 0;
      const boxes: ReturnType<typeof placementBox>[] = [];
      for (const l of lots) {
        if (ids.has(l.id)) continue;
        ids.add(l.id);
        h.state.lots.push({...l});
        boxes.push(placementBox(l.itemId, l));
        k++;
      }
      if (!k) continue;
      // (task studio-base-salvage-20261108-073314-01) the additive base salvage lot yields: an added lot resting on it removes it (fuel
      // placement leaves it out of its taken room, so the fuel cans lie exactly where they did before the base salvage)
      const before = h.state.lots.length;
      h.state.lots = h.state.lots.filter(l => !isSalvageLotId(l.id) || !boxes.some(b => lotBoxesOverlap(placementBox(l.itemId, l), b)));
      h.state.rolled += k - (before - h.state.lots.length);
      this.placeLots(h);
      n += k;
    }
    if (n && this.built) {
      const counts = new Map<string, number>();
      for (const h of this.all) for (const l of h.state.lots) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + 1);
      this.allocateDisplay(this.built, counts);
      this.dirty = true;
    }
    return n;
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
    const carry = new THREE.Matrix4(), m = new THREE.Matrix4();
    for (const l of h.state.lots) {
      // iteration 08 (Lane I): a drawer's lots ride along with it (holder · drawer travel · lot)
      const base = h.open && l.part !== undefined ? m.multiplyMatrices(h.matrix, this.openables.carryMatrix(h.open, l.part, carry)) : h.matrix;
      h.lotMats.set(l.id, new THREE.Matrix4().multiplyMatrices(base, lotLocalMatrix(l)));
      const b = placementBox(l.itemId, l);
      h.lotBoxes.set(l.id, new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(base).expandByScalar(LOT_MARGIN));
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
    this.openables.clear();
    this.openList.length = 0;
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
    this.openables.dispose();
    this.display.dispose();
    for (const m of [this.rimMat, ...this.hiMats.values()]) m.dispose();
    this.hiMats.clear();
  }

  // --- interaction ------------------------------------------------------------------------
  private lotsVisible(h: Holder): boolean {
    if (h.group === 'container') return h.t > 0.001;
    return h.state.open;
  }

  /** Iteration 08 (Lane I): a lot in a compartment is seen while that part is (being) opened, or through intact glass. */
  private lotVisible(h: Holder, l: Lot): boolean {
    if (l.part === undefined || !h.open) return this.lotsVisible(h);
    return h.open.parts[l.part].t > 0.001 || !!h.open.spec.parts[l.part].glass;
  }

  /** ... and can be taken once that part is open (or its glass is broken). */
  private lotTakeable(h: Holder, l: Lot): boolean {
    if (l.part === undefined || !h.open) return this.lotsVisible(h);
    return !!h.state.parts?.[l.part] || (h.open.glassBroken && !!h.open.spec.parts[l.part].glass);
  }

  private anyLotVisible(h: Holder): boolean {
    return h.open ? h.state.lots.some(l => this.lotVisible(h, l)) : this.lotsVisible(h);
  }

  /** HUD / toast facts of one compartment. */
  private partInfo(h: Holder, part: number): PartInfo {
    const spec = h.open!.spec, ps = spec.parts[part];
    // Task office-interactions-layout-20261030 (lane OPEN): a part with no compartment of its own (the server cabinet's glass doors over
    // its racked servers) is not a loot compartment: it shows its own fixture `contents` ("Close glass door", not "— empty").
    const loot = (spec.loot !== null || !!spec.shared) && (ps.surfaces.length > 0 || !!ps.holdsExposed);
    return {name: ps.name, label: HOLDER_LABEL[h.kind], loot, contents: ps.contents ?? spec.contents, glass: ps.glass && !h.open!.glassBroken};
  }

  /** Compartment under a body hit point: the part whose closed box holds it; containers fall back to the nearest part. */
  private partAt(h: Holder, eye: THREE.Vector3, dir: THREE.Vector3, t: number): number | null {
    const rt = h.open!;
    const p = eye.clone().addScaledVector(dir, t + 0.02).applyMatrix4(new THREE.Matrix4().copy(rt.matrix).invert());
    let best = -1, bd = Infinity;
    rt.model.parts.forEach((pm, i) => {
      const d = pm.bounds.distanceToPoint(p);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return null;
    return h.group === 'container' || bd < 0.04 ? best : null;
  }

  /** [E] on a whole openable (no aimed part: QA / tests): take from an open part, open one with loot, close an open one. */
  private defaultPart(h: Holder): number {
    const st = h.state, n = h.open!.parts.length;
    const has = (i: number) => st.lots.some(l => l.part === i);
    for (let i = 0; i < n; i++) if (st.parts![i] && has(i)) return i;
    for (let i = 0; i < n; i++) if (!st.parts![i] && has(i)) return i;
    for (let i = 0; i < n; i++) if (st.parts![i]) return i;
    for (let i = 0; i < n; i++) if (!st.seen![i]) return i;
    return 0;
  }

  /** Open / take / close one compartment of an openable holder. Never adds or re-rolls loot. */
  private interactPart(h: Holder, part: number): void {
    const st = h.state, rt = h.open!, spec = rt.spec;
    if (rt.loose || !st.parts) return;
    switch (partAction(st, part)) {
      case 'open': {
        const first = !st.seen![part];
        // sliding panes of one group: opening one slides the other shut
        const g = spec.parts[part].group;
        if (g) spec.parts.forEach((q, i) => { if (i !== part && q.group === g) st.parts![i] = false; });
        st.parts[part] = true;
        st.seen![part] = true;
        // Task mall-playtest-revision-20261031 (lane SHOPS, U10): partner parts open with it (a carton's two flaps)
        const also = spec.parts[part].opensWith ?? [];
        for (const j of also) { st.parts[j] = true; st.seen![j] = true; }
        st.searched = true;
        st.open = true;
        const m = first ? partOpenMessage(st, part, this.partInfo(h, part), also) : null;
        this.emit({type: 'open', container: h, part, sound: spec.sound.open, rummage: this.partInfo(h, part).loot, ...(m ? {message: m.text, warn: m.warn} : {})}); // lane OPEN: per part
        break;
      }
      case 'take':
        this.afterTake(h, takeLots(st, st.lots.filter(l => l.part === part).map(l => l.id), this.inventory()));
        break;
      case 'close':
        st.parts[part] = false;
        for (const j of spec.parts[part].opensWith ?? []) st.parts[j] = false; // (lane SHOPS U10: partner parts close with it)
        if (h.group === 'container') st.open = st.parts.some(Boolean);
        this.emit({type: 'close', container: h, part, sound: spec.sound.close});
        break;
    }
    this.dirty = true;
  }

  private displayId(h: Holder, l: Lot): number {
    return h.serial * 1000 + (l.id % 1000);
  }

  /**
   * What the crosshair is on within reach: an aimed item (inside an open container, on a shelf,
   * kiosk or vending spill) or a holder body. Not behind a wall, and closer than `maxT` (pass the
   * distance of a targeted floor pickup so a closer pickup wins). Items win over their own holder.
   */
  target(eye: THREE.Vector3, dir: THREE.Vector3, world: Grid | Levels, maxT = Infinity): ContainerTarget | null {
    this.lastEye.copy(eye);
    let lotBest: {h: Holder; lot: Lot; t: number} | null = null;
    let body: {h: Holder; t: number; part?: number} | null = null;
    const bodies: {h: Holder; t: number; part?: number}[] = [];
    const range = (LOT_REACH + 2) ** 2;
    for (const h of this.all) {
      if (h.open?.loose) continue; // iteration 08: a knocked-over trash can is a loose prop now (its lots spilled)
      const dx = h.prop.x - eye.x, dz = h.prop.z - eye.z;
      if (dx * dx + dz * dz > range) continue;
      const hit = rayAabb(eye, dir, h.min, h.max);
      if (hit && hit.t < Math.min(CONTAINER_REACH, maxT)) bodies.push({h, t: hit.t});
      // iteration 08 (Lane I): compartments — a pulled-out drawer / swung door is aimed at outside the prop box too
      const pk = h.open ? this.openables.pick(h, eye, dir, Math.min(CONTAINER_REACH, maxT)) : null;
      if (pk) bodies.push({h, t: pk.t, part: pk.part});
      if (!this.anyLotVisible(h)) continue;
      for (const lot of h.state.lots) {
        if (h.open && !this.lotVisible(h, lot)) continue;
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
      out = blocker ? {container: blocker.h, t: blocker.t, lot: null, part: blocker.part ?? null} : {container: lotBest.h, t: lotBest.t, lot: lotBest.lot};
    } else if (body) out = {container: body.h, t: body.t, lot: null, part: body.part ?? null};
    // Iteration 08 (Lane I): the body of an openable resolves to the compartment under the crosshair.
    if (out && !out.lot && out.container.open && out.part == null) out.part = this.partAt(out.container, eye, dir, out.t);
    // Empty tables/desks are just furniture (their drawers are not).
    if (out && !out.lot && out.part == null && (out.container.kind === 'table' || out.container.kind === 'desk') && !out.container.state.lots.some(l => l.part === undefined)) out = null;
    if (out) {
      if (world instanceof Grid) {
        const hl = Math.hypot(dir.x, dir.z);
        if (hl > 1e-6 && world.raycast(eye.x, eye.z, dir.x, dir.z, out.t * hl + 0.01, true) < out.t * hl - 0.03) out = null;
      } else {
        // iteration 08 (Lane B): 3D occlusion — walls, floors, slab undersides, stair flights between eye and holder
        const w = world.raycast(eye, dir, out.t + 0.01);
        if (w.kind !== 'none' && w.t < out.t - 0.03) out = null;
      }
    }
    this.setHighlight(out && !out.lot && (out.container.open ? out.part != null : out.container.group === 'container') && !out.container.broken ? out.container : null, out?.part ?? -1);
    const lotId = out?.lot ? this.displayId(out.container, out.lot) : -1;
    if (lotId !== this.highlightLot) { this.highlightLot = lotId; this.dirty = true; }
    return out;
  }

  /** [E] on a target: take the aimed item, or open / pry / take all / close the holder. */
  interact(target: ContainerTarget | Holder): void {
    const h = 'container' in target ? target.container : target;
    const lot = 'container' in target ? target.lot : null;
    const inv = this.inventory();
    if (lot && (h.open ? this.lotTakeable(h, lot) : this.lotsVisible(h)) && h.state.lots.includes(lot)) {
      this.afterTake(h, takeLot(h.state, lot.id, inv));
      return;
    }
    // Iteration 08 (Lane I): openable compartments (an item seen through a closed glass door opens the door first).
    if (h.open) {
      const aimed = 'container' in target ? (lot && lot.part !== undefined ? lot.part : target.part ?? null) : null;
      const part = aimed ?? (h.group === 'container' || !h.state.lots.some(l => l.part === undefined) ? this.defaultPart(h) : null);
      if (part !== null) { this.interactPart(h, part); return; }
      // the exposed top of a desk / tool chest / kitchenette: take what lies there, never what is shut in its drawers
      const ids = h.state.lots.filter(l => l.part === undefined).map(l => l.id);
      if (ids.length) this.afterTake(h, takeLots(h.state, ids, inv));
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
    // Iteration 08 (Lane I): openable compartments ("Open trash can", "Open top drawer", "Take all (2)", "Close locker").
    if (h.open) {
      const aimed = 'container' in target ? (lot && lot.part !== undefined && !this.lotTakeable(h, lot) ? lot.part : lot ? null : target.part ?? null) : null;
      const part = aimed ?? (!lot && (h.group === 'container' || !h.state.lots.some(l => l.part === undefined)) ? this.defaultPart(h) : null);
      if (part !== null) {
        const q = partPrompt(h.state, part, this.partInfo(h, part), {roomForAny: h.state.lots.some(l => l.part === part && inv.hasRoomFor(l.itemId))});
        return q.key ? `<b>[E]</b> ${q.text}` : q.text;
      }
      if (!lot) {
        const top = h.state.lots.filter(l => l.part === undefined);
        const room = top.some(l => inv.hasRoomFor(l.itemId)) ? '' : ' — no room (Tab: inventory)';
        return top.length ? `<b>[E]</b> Take all (${top.length})${room} · or aim at an item` : `${HOLDER_LABEL[h.kind][0].toUpperCase()}${HOLDER_LABEL[h.kind].slice(1)} — nothing left on top`;
      }
    }
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
    // Iteration 08 (Lane I): openable compartments animate (taken over while they move); drawers carry their lots along.
    for (const h of this.openables.update(dt, this.openList, this.highlighted)) { this.placeLots(h); this.dirty = true; }
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
    if (this.highlighted) highlightPulse(this.hiMats.values(), time); // (world/highlight.ts: shared with the player train's doors)
    this.display.pulse(time);
  }

  /** Rewrites the visible item instances: nearby holders whose contents can be seen. */
  private refresh(): void {
    this.dirty = false;
    this.refreshT = REFRESH;
    const list: LotInstance[] = [];
    const r2 = LOT_VIEW_DIST * LOT_VIEW_DIST;
    for (const h of this.all) {
      h.shown = this.anyLotVisible(h);
      if (!h.shown || !h.state.lots.length) continue;
      const dx = h.prop.x - this.lastEye.x, dz = h.prop.z - this.lastEye.z;
      if (dx * dx + dz * dz > r2) continue;
      for (const l of h.state.lots) if (!h.open || this.lotVisible(h, l)) list.push({id: this.displayId(h, l), itemId: l.itemId, matrix: h.lotMats.get(l.id)!});
    }
    this.display.show(list, this.highlightLot >= 0 ? this.highlightLot : null);
  }

  private emit(e: ContainerEvent): void {
    this.onEvent?.(e);
  }

  private setHighlight(c: Holder | null, part = -1): void {
    if (c === this.highlighted && part === this.highlightPart) return;
    if (this.highlighted) for (const m of this.highlighted.leafMeshes) m.material = (m.userData.baseMat as THREE.Material) ?? m.material;
    this.highlighted = c;
    this.highlightPart = part;
    if (!c) return;
    // iteration 08 (Lane I): an openable glows on the aimed part only (its own meshes exist while it is aimed at)
    if (c.open) { this.openables.takeover(c); c.leafMeshes = part >= 0 ? c.open.parts[part].meshes : []; }
    for (const m of c.leafMeshes) {
      const base = (m.userData.baseMat as THREE.Material | undefined) ?? (m.material as THREE.Material);
      m.userData.baseMat = base;
      const hi = this.highlightOf(base);
      if (hi) m.material = hi;
    }
  }

  /** The aim highlight clone of `base` (cached: one per base material; null for non-standard materials, which never glow). */
  private highlightOf(base: THREE.Material): THREE.MeshStandardMaterial | null {
    if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) return null;
    let hi = this.hiMats.get(base);
    if (!hi) { hi = cloneSurfaceMaterial(base as THREE.MeshStandardMaterial); this.hiMats.set(base, hi); } // Lane D: keeps damage / wound hooks (iteration 13: node hooks)
    return hi;
  }

  /**
   * Task runtime-variant-warmup-20261105 (render/runtimeVariants.ts): the holders' runtime-variant prototypes — openable takeovers
   * (world/openables.ts takeoverPrototypes), the aim highlight on every aimable mesh (the SAME cached clone setHighlight puts on it:
   * highlightOf) and `own` = the meshes damage can take over (prototype takeovers + one legacy container per kind), for
   * PropDamage.variantPrototypes; `lotHighlights` = loot item types whose highlight copy is now prepared (LotDisplay.prepareHighlights).
   * Pure: no holder, lot, highlight or takeover state changes; legacy holders' real meshes are only READ (their geometry / material /
   * flags) — every returned prototype is a new mesh.
   */
  runtimeVariantPrototypes(): {takeover: THREE.Mesh[]; highlight: THREE.Mesh[]; own: THREE.Mesh[]; lotHighlights: number} {
    const lotHighlights = this.display.prepareHighlights(); // (the loot highlight copies: real cached copies, hidden in this pool)
    const t = this.openables.takeoverPrototypes();
    const highlight: THREE.Mesh[] = [], own: THREE.Mesh[] = [...t.meshes];
    const glow = (m: THREE.Mesh) => {
      const base = (m.userData.baseMat as THREE.Material | undefined) ?? (m.material as THREE.Material);
      const hi = this.highlightOf(base);
      if (!hi) return;
      const p = new THREE.Mesh(m.geometry, hi);
      p.castShadow = m.castShadow;
      p.receiveShadow = m.receiveShadow;
      p.name = m.name;
      highlight.push(p);
    };
    for (const m of t.aimable) glow(m);
    const kinds = new Set<string>();
    for (const h of this.list) {
      if (!h.root || h.open || kinds.has(h.kind)) continue; // (one legacy container per kind: the same model per kind)
      kinds.add(h.kind);
      for (const m of h.leafMeshes) glow(m);
      h.root.traverse(o => { if ((o as THREE.Mesh).isMesh) own.push(o as THREE.Mesh); });
    }
    return {takeover: t.meshes, highlight, own, lotHighlights};
  }

  // --- Iteration 06 (Lane D): damage / breaking ------------------------------------------
  /** The loot holder standing on this prop placement, if any. */
  holderFor(prop: PropPlacement): Holder | null {
    return this.all.find(h => h.prop === prop) ?? null;
  }

  /**
   * Task studio-beta-train-all-cargo-20261107-184244-01 (world/trainPropCargo.ts): a holder with no lots at all — a CARRIED holder's copy
   * (it spilled its finite lots when it was knocked loose, where it stood; they travel as item cargo) or one its station lost to the
   * train. Never invented loot; the display follows next frame. False: not a holder.
   */
  emptyHolder(prop: PropPlacement): boolean {
    const h = this.holderFor(prop);
    if (!h) return false;
    h.state.lots = [];
    h.lotMats.clear();
    h.lotBoxes.clear();
    if (this.highlighted === h) this.setHighlight(null);
    this.highlightLot = -1;
    this.dirty = true;
    return true;
  }

  /** Task cargo-overflow: the holder's own world-matrix-driven root (a loose spill holder's lid / liner), or null. */
  ownRoot(prop: PropPlacement): THREE.Object3D | null {
    const h = this.holderFor(prop);
    return h?.open?.root ?? h?.root ?? null;
  }

  /**
   * Task train-all-cargo: a holder its station lost to the train (a revisit): emptied, never an [E] target again (loose: the hit test skips
   * it), its own meshes out of the scene. Its shared body instances are hidden by the caller (the damage render index).
   */
  removeHolder(prop: PropPlacement): boolean {
    const h = this.holderFor(prop);
    if (!h || !this.emptyHolder(prop)) return false;
    if (h.open) {
      this.openables.takeover(h);
      h.open.loose = h.open.pinned = true;
      h.open.root?.removeFromParent();
    } else h.root?.removeFromParent();
    return true;
  }

  /** Meshes drawn for this holder alone (doors / lid / interior), for per-instance damage. */
  ownMeshes(prop: PropPlacement): THREE.Mesh[] {
    const h = this.holderFor(prop);
    if (h?.open) return this.openables.ownMeshes(h); // iteration 08: takes it over for good (pinned)
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
    // Iteration 08 (Lane I): a glazed door's glass shattered: its compartment is reachable through the empty frame.
    if (h.open) { if (kind === 'shatter') { h.open.glassBroken = true; this.dirty = true; } return; }
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
      if (!h.state.lots.length || !this.anyLotVisible(h)) continue;
      const rx = h.prop.x - o.x, rz = h.prop.z - o.z, along = rx * d.x + rz * d.z, reach = Math.max(h.prop.hx, h.prop.hz) + 1.5;
      if (along < -reach || along > maxT + reach || Math.hypot(rx - d.x * along, rz - d.z * along) > reach) continue;
      for (const l of h.state.lots) {
        if (h.open && !this.lotVisible(h, l)) continue; // iteration 08: closed compartments shield their lots
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
    if (!h.open && !this.lotsVisible(h)) return null;
    const i = h.state.lots.findIndex(l => l.id === lotId);
    if (i < 0) return null;
    if (h.open && !this.lotVisible(h, h.state.lots[i])) return null; // iteration 08: per compartment
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
      if (!h.state.lots.length || Math.abs(h.prop.x - c.x) > h.prop.hx + 0.8 || Math.abs(h.prop.z - c.z) > h.prop.hz + 0.8 || !this.anyLotVisible(h)) continue;
      for (const l of h.state.lots) {
        if (h.open && !this.lotVisible(h, l)) continue;
        const lb = h.lotBoxes.get(l.id);
        if (lb && b.copy(lb).expandByScalar(-LOT_MARGIN).intersectsBox(box)) out.push({holder: h, lotId: l.id});
      }
    }
    return out;
  }

  /** Item / chunk collision of a loot holder (its shelves, physics/holderShapes.ts); null: not a holder (solid box). */
  physicsBoxes(prop: PropPlacement): THREE.Box3[] | null {
    const h = this.holderFor(prop);
    if (!h) return null;
    if (h.open) return this.openPhysicsBoxes(h, prop);
    return holderBoxes(prop, h.support ?? h.surfaces, {broken: !!h.broken}); // (lane MERCH: uncut — the shelf under its decor too)
  }

  /**
   * Iteration 08 (Lane I): item / chunk collision of an openable. Closed compartments keep the prop one solid box (a closed
   * trash can stops a flying can, as before); an OPEN lid / door compartment gets its resting surfaces plus walls round its
   * cavity (no roof; lids keep a front wall, doors are open at the front) so its own lots rest inside and shots knock them
   * out. Drawer trays travel out of the box and add nothing. The glass cooler keeps its iteration-07 shelves + glass front.
   * Call physics.propsChanged() when a compartment opens / closes (game.ts does).
   */
  private openPhysicsBoxes(h: Holder, prop: PropPlacement): THREE.Box3[] | null {
    const rt = h.open!;
    if (rt.loose) return [];
    const base = Math.abs(rt.matrix.elements[13] - prop.y) > 1e-6 ? {...prop, y: rt.matrix.elements[13]} : prop;
    const sup = h.support ?? h.surfaces; // (lane MERCH: uncut — the shelf under its decor too)
    if (h.kind === 'shopCooler') return holderBoxes(base, sup, {broken: !!h.broken, glassBroken: rt.glassBroken});
    const exposed = sup.filter(q => q.part === undefined);
    const open = rt.spec.parts.map((_, i) => i).filter(i => rt.spec.parts[i].move.type === 'hinge' && h.state.parts?.[i]);
    if (!open.length) return exposed.length ? holderBoxes(base, exposed, {broken: !!h.broken}) : null;
    const out = holderBoxes(base, [...exposed, ...sup.filter(q => q.part !== undefined && open.includes(q.part))], {broken: !!h.broken}) ?? [];
    const T = 0.03, local: [number, number, number, number, number, number][] = [];
    for (const i of open) {
      const ps = rt.spec.parts[i];
      const c = ps.cavity ?? (ps.cylinder ? [-ps.cylinder[0], ps.cylinder[1], -ps.cylinder[0], ps.cylinder[0], ps.cylinder[2], ps.cylinder[0]] as const : null);
      if (!c) continue;
      const [x0, , z0, x1, y1, z1] = c;
      local.push([x0 - T, 0, z0 - T, x0, y1, z1 + T], [x1, 0, z0 - T, x1 + T, y1, z1 + T], [x0 - T, 0, z0 - T, x1 + T, y1, z0]);
      if (ps.move.type === 'hinge' && ps.move.axis === 'x') local.push([x0 - T, 0, z1, x1 + T, y1, z1 + T]); // a lid: the front wall stays
    }
    const v = new THREE.Vector3();
    for (const [ax, ay, az, bx, by, bz] of local) {
      const b = new THREE.Box3();
      for (const x of [ax, bx]) for (const y of [ay, by]) for (const z of [az, bz]) b.expandByPoint(v.set(x, y, z).applyMatrix4(rt.matrix));
      out.push(b);
    }
    return out;
  }

  // --- Iteration 08 (Lane I): openables ------------------------------------------------------
  /**
   * Physics knocked this holder loose (a shot trash can / wheelie bin, physics/dynamicItems.ts): its lid pops part-way open,
   * its finite lots are lifted off and SPILLED on the floor where it stood (event 'spill' with their world matrices: the game
   * turns them into loose pickups — same item ids / counts) and its own meshes are returned for the rigid body to carry.
   */
  goLoose(prop: PropPlacement): THREE.Object3D[] {
    const h = this.holderFor(prop);
    const rt = h?.open;
    if (!h || !rt || !rt.spec.spill) return [];
    if (rt.loose) return rt.root ? [rt.root] : [];
    this.openables.takeover(h);
    rt.loose = rt.pinned = true;
    rt.parts.forEach((ps, i) => { ps.amount = Math.sign(ps.amount || -1) * Math.min(Math.abs(ps.amount), 0.6); h.state.parts![i] = true; h.state.seen![i] = true; });
    h.state.open = h.state.searched = true;
    const spilled: {lot: Lot; matrix: THREE.Matrix4}[] = [];
    h.state.lots.forEach((l, k) => {
      // fallen out where the can stood: lying on its storey's floor, spread around the base
      const a = k * 2.39996 + (l.id % 7) * 0.9, r = 0.1 + 0.16 * ((k * 0.618 + 0.3) % 1);
      const shape = itemDims(l.itemId).shape;
      const flat: Lot = {...l, x: 0, y: 0, z: 0, yaw: a * 1.7, orient: shape === 'cylinder' ? 'side' : shape === 'box' ? 'back' : 'up'};
      const m = new THREE.Matrix4().makeTranslation(prop.x + Math.cos(a) * r, prop.y + 0.004, prop.z + Math.sin(a) * r).multiply(lotLocalMatrix(flat));
      spilled.push({lot: l, matrix: m});
    });
    h.state.lots = [];
    h.lotMats.clear();
    h.lotBoxes.clear();
    if (this.highlighted === h) this.setHighlight(null);
    this.highlightLot = -1;
    this.dirty = true;
    this.emit({type: 'spill', container: h, spilled, ...(spilled.length ? {message: `The ${HOLDER_LABEL[h.kind]} goes over — ${spilled.length} item${spilled.length === 1 ? '' : 's'} spill out`} : {})});
    return rt.root ? [rt.root] : [];
  }

  /** QA: per-kind openable counts, open state, contents and clearance; and one holder's parts. */
  openablesQa(): unknown {
    const byKind: Record<string, {count: number; levels: Record<number, number>; parts: number; open: number; cramped: number; lots: number; lotsAtStart: number; taken: number; loose: number}> = {};
    for (const h of this.openList) {
      const rt = h.open!;
      const k = (byKind[h.kind] ??= {count: 0, levels: {}, parts: 0, open: 0, cramped: 0, lots: 0, lotsAtStart: 0, taken: 0, loose: 0});
      k.count++;
      k.levels[h.prop.level ?? 0] = (k.levels[h.prop.level ?? 0] ?? 0) + 1;
      k.parts += rt.parts.length;
      k.open += h.state.parts!.filter(Boolean).length;
      k.cramped += rt.parts.filter(p => p.cramped).length;
      k.lots += h.state.lots.filter(l => l.part !== undefined).length;
      k.lotsAtStart += h.state.rolled;
      if (rt.root) k.taken++;
      if (rt.loose) k.loose++;
    }
    return {byKind, models: this.openables.qaModels(), stats: {...this.openables.stats}, active: this.openables.active.size};
  }

  /** QA: one openable holder (by serial) — per-part state, opening, lots inside, aim / stand points. */
  openableState(serial: number): unknown {
    const h = this.all[serial];
    const rt = h?.open;
    if (!h || !rt) return null;
    return {
      serial, kind: h.kind, label: HOLDER_LABEL[h.kind], level: h.prop.level ?? 0, x: h.prop.x, y: h.prop.y, z: h.prop.z, rot: h.prop.rot, loose: rt.loose, taken: !!rt.root,
      parts: rt.parts.map((ps, i) => {
        const a = this.openables.aimPoint(rt, i);
        return {
          name: rt.spec.parts[i].name, move: rt.spec.parts[i].move.type, open: !!h.state.parts![i], seen: !!h.state.seen![i], t: +ps.t.toFixed(3),
          amount: +ps.amount.toFixed(3), cramped: ps.cramped, lots: h.state.lots.filter(l => l.part === i).map(l => ({id: l.id, itemId: l.itemId, count: l.count, at: this.lotPoint(h, l)})),
          aim: {x: a.aim.x, y: a.aim.y, z: a.aim.z}, stand: {x: a.stand.x, z: a.stand.z},
        };
      }),
    };
  }

  // --- QA ---------------------------------------------------------------------------------
  /** Point on the holder to aim at (cabinet door centre / crate lid / shelf middle) and a spot to stand. */
  aimPoint(c: Holder): {aim: {x: number; y: number; z: number}; stand: {x: number; z: number}} {
    if (c.open) { const a = this.openables.aimPoint(c.open, 0); return {aim: {x: a.aim.x, y: a.aim.y, z: a.aim.z}, stand: {x: a.stand.x, z: a.stand.z}}; }
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
