// Task reactor-build-20261101 (lane ARCH): THE REACTOR's architecture — the B "Industrial Service Cathedral" look over GEN's layout
// (reference/tasks/reactor-concepts-20261101-203831/concepts/B-service-cathedral-attempt2.png). Installed from world/builder.ts
// exactly like MallArch (`ReactorArch.for(layout, …)`: null for every other level, so the Subway / Office / Mall never reach it):
//  1. SURFACES: the builder asks for the finish of every wall / floor / ceiling / door trim / stair flight; on a Reactor layout the
//     pit walls (any face whose open side is inside the pit outline) are stained pit concrete, the deck / gallery / bridge / stair
//     floors in the pit steel grating with rusted plate under them, the pit roof dark concrete, rooms cut into the rock rusted plate
//     walls + concrete floors. The rim station (level 0 outside the pit, non-'reactor-*' areas) keeps its Subway finishes.
//  2. KIT (build): the industrial steel from layout.reactor (world/reactor/archKit.ts plan -> archMeshes.ts instancing) — deck
//     steel, lattice towers, the gantry crane, organ pipe banks, extraction fans, generators, the vessel, site machines, screen
//     frames, cable runs, tier bands + stencilled labels, wall pilasters, lamps, rusted railings (the collision rails, ownsRail) —
//     with the lead's Meshy models swapped in where loaded (archAssets.ts registry).
//  3. SIGHT: `pitMask` (cells inside the pit outline) is the level culler's ATRIUM mask (world/levelCulling.ts): every tier stays
//     visible through the open pit while closed rooms behind the rock cull.
//  4. VISUALS: `visuals` implements ReactorVisuals (archVisuals.ts); the builder registers it (registerReactorArchVisuals).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CELL} from '../../gen/grid';
import type {Level, RailRun} from '../../gen/levels';
import type {Area, StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import type {MatKey, WorldMaterials} from '../materials';
import {cellCeil, type BuiltFace} from '../levelGeometry';
import {inPoly, planReactorKit, type KitPlan, type KitStats} from './archKit';
import {buildKitMeshes, kitGeometry, type KitBuildStats, type KitBuilt} from './archMeshes';
import {isReactorKey, reactorDress, reactorSurfaceMaterial, reactorSurfaceScale, type ReactorSurfaceKey} from './archMaterials';
import {REACTOR_MODELS, REACTOR_PIECES, type ReactorPiece} from './archAssets';
import {ReactorArchVisuals} from './archVisuals';
import type {MeshBasicNodeMaterial} from 'three/webgpu';

export interface ReactorArchStats {
  kit: KitStats | null;
  meshes: KitBuildStats | null;
  /** Pieces drawn from a delivered model. */
  models: ReactorPiece[];
  /** Faces / floors / ceilings remapped to reactor finishes (by key). */
  faces: Record<string, number>;
  pitCells: number;
  /** GEN's light fixtures in the pit drawn as caged lamps (buildLamps). */
  lamps: number;
  ms: number;
}

/** Areas of the Reactor proper (GEN's 'reactor-*' room types, or any area below the rim). */
export function isReactorArea(a: Area | undefined, level: number): boolean {
  if (!a) return level > 0;
  if (typeof a.type === 'string' && (a.type as string).startsWith('reactor')) return true;
  return (a.level ?? 0) > 0 || level > 0;
}

export class ReactorArch {
  readonly info: ReactorInfo;
  /** Per cell of the level grids: 1 = inside the pit outline (the culler's atrium mask; the pit finishes). */
  readonly pitMask: Uint8Array;
  private readonly W: number;
  private readonly H: number;
  /** The core floor's level (the last tier). */
  private readonly coreLevel: number;
  plan: KitPlan | null = null;
  built: KitBuilt | null = null;
  visuals: ReactorArchVisuals = new ReactorArchVisuals(null, null, null);
  readonly stats: ReactorArchStats = {kit: null, meshes: null, models: [], faces: {}, pitCells: 0, lamps: 0, ms: 0};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): ReactorArch | null {
    const r = (layout as {reactor?: ReactorInfo}).reactor;
    return r && levels.length && r.pit?.outline?.length >= 3 ? new ReactorArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    this.info = (layout as {reactor?: ReactorInfo}).reactor!;
    const g0 = levels[0].grid;
    this.W = g0.w; this.H = g0.h;
    this.pitMask = new Uint8Array(this.W * this.H);
    const b = this.info.pit.bounds, P = this.info.pit.outline;
    for (let cy = Math.max(0, Math.floor(b.z0 / CELL)); cy < Math.min(this.H, Math.ceil(b.z1 / CELL)); cy++) {
      for (let cx = Math.max(0, Math.floor(b.x0 / CELL)); cx < Math.min(this.W, Math.ceil(b.x1 / CELL)); cx++) {
        if (inPoly(P, (cx + 0.5) * CELL, (cy + 0.5) * CELL)) { this.pitMask[cy * this.W + cx] = 1; this.stats.pitCells++; }
      }
    }
    const tiers = [...this.info.tiers].sort((p, q) => p.baseY - q.baseY);
    this.coreLevel = tiers[0]?.level ?? -1;
  }

  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }
  private inPit(x: number, z: number): boolean {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H && this.pitMask[cy * this.W + cx] === 1;
  }
  private levelIndex(id: number): number { const i = this.levels.findIndex(l => l.id === id); return i < 0 ? 0 : i; }

  // -------------------------------------------------------------------------------------------------------------------------
  // Surfaces (builder hooks)

  /** Reactor finishes for the builder's wall faces (pit concrete facing the pit; rusted plate in the rooms; the rim station kept). */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    const out: F[] = [];
    for (const f of faces) {
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const mx = alongX ? (f.x0 + f.x1) / 2 : f.x0 + f.nx * CELL / 2, mz = alongX ? f.z0 + f.nz * CELL / 2 : (f.z0 + f.z1) / 2;
      let key: ReactorSurfaceKey | null = null;
      if (this.inPit(mx, mz)) key = 'reactor-wall';
      else if (isReactorArea(f.area >= 0 ? this.layout.areas[f.area] : undefined, f.level)) key = 'reactor-room-wall';
      if (!key) { out.push(f); continue; }
      this.count(key);
      out.push({...f, finish: key});
    }
    return out;
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule — the rim station). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    if (this.pitMask[i]) return lvl.id === this.coreLevel ? 'reactor-floor' : 'reactor-grating';
    const a = this.layout.areas[lvl.grid.area[i]];
    return isReactorArea(a, lvl.id) ? 'reactor-floor' : null;
  }

  /** Ceiling key of a run (null: builder rule). In the pit: the roof at the top, the deck undersides below. */
  ceilKey(L: number, areaId: number, i?: number, y?: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    if (i !== undefined && this.pitMask[i]) {
      const top = y ?? cellCeil(lvl.grid, i);
      return top >= this.info.pit.roofY - 0.6 ? 'reactor-roof' : 'reactor-deck-under';
    }
    return isReactorArea(areaId >= 0 ? this.layout.areas[areaId] : undefined, lvl.id) ? 'reactor-ceil' : null;
  }

  /** Door opening soffit (null: station rule). */
  doorCeilKey(L: number, a: Area | undefined, b: Area | undefined): string | null {
    const id = this.levels[L]?.id ?? 0;
    return isReactorArea(a, id) || isReactorArea(b, id) ? 'reactor-ceil' : null;
  }

  /** Door frame trim (null: the station's steel). */
  doorTrimKey(level: number, a: Area | undefined): string | null {
    return isReactorArea(a, level) ? 'reactor-trim' : null;
  }

  /** Stair flight finishes (traversalBuilder MatKeys) in the pit / below the rim: steel grating treads, rusted plate soffits. */
  stairKey(k: MatKey | string, x: number, z: number, level: number): string {
    if (!this.inPit(x, z) && level <= 0) {
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      const a = cx >= 0 && cy >= 0 && cx < this.W && cy < this.H ? this.layout.areas[this.levels[this.levelIndex(level)].grid.area[cy * this.W + cx]] : undefined;
      if (!isReactorArea(a, level)) return k;
    }
    if (k === 'concrete' || k === 'terrazzo') return 'reactor-grating';
    if (k === 'ceiling' || k === 'ceilingService') return 'reactor-deck-under';
    return k;
  }

  scale(key: string): {u: number; v: number} | undefined {
    return isReactorKey(key) ? reactorSurfaceScale(this.mats, key) : undefined;
  }
  material(key: string): THREE.Material | undefined {
    return isReactorKey(key) ? reactorSurfaceMaterial(this.mats, key) : undefined;
  }
  meshName(key: string): string | undefined {
    return isReactorKey(key) ? `reactor-arch-${key.slice(8)}` : undefined;
  }

  /** Rail runs ARCH draws (rusted steel, instanced): every railing of the Reactor proper; the rim station's own rails stay. */
  ownsRail(r: RailRun): boolean {
    if (r.kind === 'parapet') return false;
    return r.level > 0 || this.inPit((r.x0 + r.x1) / 2 + r.nx * 0.3, (r.z0 + r.z1) / 2 + r.nz * 0.3) || this.inPit((r.x0 + r.x1) / 2 - r.nx * 0.3, (r.z0 + r.z1) / 2 - r.nz * 0.3);
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // GEN's light fixtures in the pit: caged industrial lamps (the lighting system's tube instance becomes the cage's lens)

  /** A real (non-virtual) layout light inside the pit: drawn as a caged lamp, not a Subway tube fixture (rooms keep tubes). */
  isLamp(l: {x: number; z: number; virtual?: boolean}): boolean {
    return !l.virtual && this.inPit(l.x, l.z);
  }

  /** The tube instance of a pit lamp as its lens: a 0.2 m glowing square under the cage (0.36 m below the light point). */
  lampLensMatrix(m: THREE.Matrix4, fixture: {w: number; h: number; d: number}): THREE.Matrix4 {
    const sx = 0.2 / (fixture.w * 0.82), sz = 0.2 / (fixture.d * 0.42);
    return m.clone().multiply(new THREE.Matrix4().makeTranslation(0, fixture.h + 0.004 - 0.36, 0)).multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
  }

  /** Cages + hangers of the pit lamps (instanced per tier; the light points are the layout's): returns the instance count. */
  buildLamps(group: THREE.Group, lightMats: readonly THREE.Matrix4[], lights: readonly {x: number; y: number; z: number; level?: number; virtual?: boolean}[]): number {
    const byLevel = new Map<number, THREE.Matrix4[][]>();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    lights.forEach((l, i) => {
      if (!this.isLamp(l)) return;
      lightMats[i].decompose(p, q, s);
      const cage = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.19, p.z), q, new THREE.Vector3(0.26, 0.34, 0.26));
      const hanger = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.22, p.z), q, new THREE.Vector3(0.05, 0.44, 0.05));
      const lv = l.level ?? 0;
      let e = byLevel.get(lv);
      if (!e) byLevel.set(lv, (e = [[], []]));
      e[0].push(cage); e[1].push(hanger);
    });
    if (!byLevel.size) return 0;
    const dress = reactorDress(this.mats);
    const cageGeo = kitGeometry('cage'), rodGeo = kitGeometry('tube');
    let n = 0;
    for (const [lv, [cages, rods]] of byLevel) {
      const above = this.info.tiers.filter(t => t.baseY > (this.info.tiers.find(u => u.level === lv)?.baseY ?? 0)).sort((a, b) => a.baseY - b.baseY)[0]?.level;
      for (const [geo, list, name] of [[cageGeo, cages, 'cage'], [rodGeo, rods, 'hanger']] as const) {
        const im = new THREE.InstancedMesh(geo, dress.steelDark, list.length);
        list.forEach((m, k) => im.setMatrixAt(k, m));
        im.name = `reactor-lamp-${name}-L${lv}`;
        im.userData.levels = above === undefined ? [lv] : [lv, above];
        im.computeBoundingSphere();
        group.add(im);
      }
      n += cages.length;
    }
    this.stats.lamps = n;
    return n;
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // The kit

  /** The industrial kit into `group` (before the warm-up): plan -> instanced meshes; registers nothing (the builder does). */
  build(group: THREE.Group, rails: readonly RailRun[], models: Readonly<Record<string, GLTF | undefined>>): ReactorArchStats {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const loaded = new Set<ReactorPiece>(REACTOR_PIECES.filter(p => REACTOR_MODELS[p].delivered && !!models[REACTOR_MODELS[p].key]));
    try {
      this.plan = planReactorKit(this.info, {models: loaded, rails: rails.filter(r => !(r as {hidden?: boolean}).hidden && this.ownsRail(r))});
      const dress = reactorDress(this.mats);
      this.built = buildKitMeshes(group, this.plan, k => dress[k], models);
      this.visuals = new ReactorArchVisuals(this.built, this.plan, dress.glow as MeshBasicNodeMaterial);
      this.stats.kit = this.plan.stats;
      this.stats.meshes = this.built.stats;
      this.stats.models = [...this.plan.modelPlacements.keys()].filter(p => !!this.built!.modelSlots.get(p));
    } catch (e) {
      console.warn('reactor arch: kit skipped', e);
    }
    this.stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return this.stats;
  }

  /** Teardown (archInstall.ts): the per-build textures (label atlas). Geometries go with the world group; shared materials stay cached. */
  dispose(): void {
    for (const t of this.built?.textures ?? []) t.dispose();
    if (this.built) this.built.textures.length = 0;
  }

  /** Summary (QA / tests). */
  summary(): {stats: ReactorArchStats; visuals: ReturnType<ReactorArchVisuals['state']>} {
    return {stats: this.stats, visuals: this.visuals.state()};
  }
}
